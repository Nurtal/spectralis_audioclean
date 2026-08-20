import { AB_CROSSFADE_S } from '../lib/constants';

export type AbSide = 'original' | 'processed';

export interface AbPlayerCallbacks {
  onEnded?: () => void;
}

/**
 * Lecteur A/B.
 *
 * Deux sources démarrées au même instant, chacune dans son gain, les deux vers
 * la sortie. La bascule ne stoppe rien : elle croise les deux gains. C'est la
 * seule façon de comparer honnêtement — arrêter puis redémarrer déplace
 * l'attention sur la coupure, et un fondu de quelques millisecondes suffit à
 * rendre la transition inaudible tout en restant instantanée à l'oreille.
 *
 * Aucune dépendance React : cet objet peut être piloté depuis n'importe où, et
 * se teste sans monter de composant.
 */
export class AbPlayer {
  private context: AudioContext | null = null;
  private originalBuffer: AudioBuffer | null = null;
  private processedBuffer: AudioBuffer | null = null;

  private originalSource: AudioBufferSourceNode | null = null;
  private processedSource: AudioBufferSourceNode | null = null;
  private originalGain: GainNode | null = null;
  private processedGain: GainNode | null = null;

  private currentSide: AbSide = 'processed';
  private compensate = true;
  private matchDb = 0;

  private startedAtContextTime = 0;
  private startOffsetS = 0;
  private isPlaying = false;
  /** Invalide les `onended` des sources qu'on vient de remplacer. */
  private generation = 0;

  constructor(private readonly callbacks: AbPlayerCallbacks = {}) {}

  /**
   * Le contexte n'est créé qu'ici, jamais au chargement de la page : sur
   * Safari iOS il resterait suspendu, et l'utilisateur n'entendrait rien sans
   * comprendre pourquoi. Cette méthode doit être appelée depuis un geste.
   */
  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    // Aucune option : on prend la fréquence de la carte son, quelle qu'elle soit.
    //
    // Le pipeline travaille à 48 kHz parce que RNNoise l'exige, et il serait
    // tentant d'imposer la même fréquence au contexte de lecture pour éviter un
    // rééchantillonnage. C'est une fausse économie : sur une sortie cadencée à
    // 44.1 kHz — le cas le plus courant — forcer 48 kHz fait ouvrir à Chrome un
    // flux que la couche audio du système doit reconvertir, et sous PulseAudio
    // ou PipeWire ça donne au mieux de la latence, au pire du silence complet.
    // Le contexte se déclare pourtant « running » et le graphe produit bien du
    // signal : la panne est en aval, invisible depuis la page.
    //
    // Un AudioBufferSourceNode sait rééchantillonner un tampon dont la
    // fréquence diffère de celle du contexte. On lui laisse ce travail : c'est
    // le chemin standard, et il est le même pour tout le monde.
    this.context = new AudioContext();
    return this.context;
  }

  get ready(): boolean {
    return this.originalBuffer !== null && this.processedBuffer !== null;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get duration(): number {
    return this.originalBuffer?.duration ?? 0;
  }

  get side(): AbSide {
    return this.currentSide;
  }

  /** Position de lecture, en secondes, lue à l'horloge audio. */
  get currentTime(): number {
    if (!this.isPlaying || !this.context) {
      return Math.min(this.startOffsetS, this.duration);
    }
    const elapsed = this.context.currentTime - this.startedAtContextTime;
    return Math.min(this.startOffsetS + elapsed, this.duration);
  }

  /**
   * @param matchDb écart de loudness mesuré (original − traité). C'est lui qui
   *   permet de comparer à volume égal, et donc de comparer autre chose que
   *   « lequel est le plus fort ».
   */
  load(
    original: Float32Array,
    processed: Float32Array,
    sampleRate: number,
    matchDb: number,
  ): void {
    const ctx = this.ensureContext();
    this.stopSources();

    // `set` plutôt que `copyToChannel` : même effet, et pas de contrainte de
    // variance sur le type du tampon sous-jacent (le nôtre traverse un worker).
    this.originalBuffer = ctx.createBuffer(1, original.length, sampleRate);
    this.originalBuffer.getChannelData(0).set(original);
    this.processedBuffer = ctx.createBuffer(1, processed.length, sampleRate);
    this.processedBuffer.getChannelData(0).set(processed);

    this.matchDb = Number.isFinite(matchDb) ? matchDb : 0;
    this.startOffsetS = 0;
    this.isPlaying = false;
  }

  /**
   * Gains d'égalisation. On atténue toujours le plus fort des deux plutôt que
   * d'amplifier le plus faible : amplifier pourrait écrêter, et un écrêtage
   * pendant une démo de nettoyage audio ne se rattrape pas.
   */
  private compensationGains(): { original: number; processed: number } {
    if (!this.compensate) return { original: 1, processed: 1 };
    if (this.matchDb <= 0) {
      return { original: 1, processed: Math.pow(10, this.matchDb / 20) };
    }
    return { original: Math.pow(10, -this.matchDb / 20), processed: 1 };
  }

  private targetGains(): { original: number; processed: number } {
    const comp = this.compensationGains();
    return this.currentSide === 'original'
      ? { original: comp.original, processed: 0 }
      : { original: 0, processed: comp.processed };
  }

  private stopSources(): void {
    this.generation++;
    for (const source of [this.originalSource, this.processedSource]) {
      if (!source) continue;
      try {
        source.stop();
      } catch {
        // Déjà arrêtée : rien à faire.
      }
      source.disconnect();
    }
    this.originalSource = null;
    this.processedSource = null;
    this.originalGain?.disconnect();
    this.processedGain?.disconnect();
    this.originalGain = null;
    this.processedGain = null;
  }

  async play(offsetS = this.currentTime): Promise<void> {
    if (!this.originalBuffer || !this.processedBuffer) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') {
      // Safari iOS refuse de démarrer hors d'un geste utilisateur. Mieux vaut
      // le signaler que d'afficher une tête de lecture qui avance dans le vide.
      throw new Error('Le navigateur a refusé de démarrer la lecture audio.');
    }

    this.stopSources();

    const offset = Math.max(0, Math.min(offsetS, this.duration - 0.001));
    const gains = this.targetGains();

    this.originalGain = ctx.createGain();
    this.processedGain = ctx.createGain();
    this.originalGain.gain.value = gains.original;
    this.processedGain.gain.value = gains.processed;
    this.originalGain.connect(ctx.destination);
    this.processedGain.connect(ctx.destination);

    this.originalSource = ctx.createBufferSource();
    this.originalSource.buffer = this.originalBuffer;
    this.originalSource.connect(this.originalGain);

    this.processedSource = ctx.createBufferSource();
    this.processedSource.buffer = this.processedBuffer;
    this.processedSource.connect(this.processedGain);

    const generation = ++this.generation;
    this.originalSource.onended = () => {
      if (generation !== this.generation) return;
      this.isPlaying = false;
      this.startOffsetS = this.duration;
      this.callbacks.onEnded?.();
    };

    // Un même instant de départ pour les deux, calé un peu dans le futur :
    // demander `currentTime` tout court laisse le navigateur démarrer les deux
    // sources sur deux quanta différents, et le décalage s'entend.
    const startAt = ctx.currentTime + 0.02;
    this.originalSource.start(startAt, offset);
    this.processedSource.start(startAt, offset);

    this.startedAtContextTime = startAt;
    this.startOffsetS = offset;
    this.isPlaying = true;
  }

  pause(): void {
    if (!this.isPlaying) return;
    const at = this.currentTime;
    this.stopSources();
    this.isPlaying = false;
    this.startOffsetS = at;
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else void this.play();
  }

  /** Repositionnement : les deux sources sont recréées au même offset. */
  seek(timeS: number): void {
    const clamped = Math.max(0, Math.min(timeS, this.duration));
    if (this.isPlaying) {
      void this.play(clamped);
    } else {
      this.startOffsetS = clamped;
    }
  }

  setSide(side: AbSide): void {
    if (side === this.currentSide) return;
    this.currentSide = side;
    this.applyGains();
  }

  setCompensate(enabled: boolean): void {
    if (enabled === this.compensate) return;
    this.compensate = enabled;
    this.applyGains();
  }

  get compensating(): boolean {
    return this.compensate;
  }

  /**
   * Le fondu se fait en `setTargetAtTime`, pas en `linearRampToValueAtTime` :
   * l'exponentielle n'a pas de rupture de pente à l'arrivée, donc pas de clic.
   * La constante de temps est le tiers de la durée visée — au bout de trois
   * constantes, on est à 95 %.
   */
  private applyGains(): void {
    if (!this.context || !this.originalGain || !this.processedGain) return;
    const now = this.context.currentTime;
    const tau = AB_CROSSFADE_S / 3;
    const gains = this.targetGains();
    this.originalGain.gain.setTargetAtTime(gains.original, now, tau);
    this.processedGain.gain.setTargetAtTime(gains.processed, now, tau);
  }

  destroy(): void {
    this.stopSources();
    this.originalBuffer = null;
    this.processedBuffer = null;
    void this.context?.close();
    this.context = null;
  }
}
