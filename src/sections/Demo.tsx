import { useCallback, useEffect, useRef } from 'react';
import { Dropzone, type SampleDescriptor } from '../components/Dropzone';
import { AbToggle } from '../components/AbToggle';
import { Transport } from '../components/Transport';
import { Waveform } from '../components/Waveform';
import { Spectrogram } from '../components/Spectrogram';
import { MetricsPanel } from '../components/MetricsPanel';
import { ProcessingProgress } from '../components/ProcessingProgress';
import { DownloadButton } from '../components/DownloadButton';
import { useProcessor } from '../hooks/useProcessor';
import { useAbPlayer } from '../player/useAbPlayer';
import type { DenoiseMode, PipelineOptions } from '../audio/types';
import { formatBytes, formatDuration, minus } from '../lib/format';
import { HIGHPASS_HZ, TARGET_LUFS } from '../lib/constants';
import '../styles/components/demo.css';

const SAMPLES: SampleDescriptor[] = [
  {
    file: 'interview-clim.mp3',
    label: 'Interview en salle de réunion',
    defect: 'ronflement de climatisation',
  },
  {
    file: 'podcast-souffle.mp3',
    label: 'Épisode de podcast',
    defect: 'souffle de préampli',
  },
  {
    file: 'voix-rue.mp3',
    label: 'Prise de son en extérieur',
    defect: 'bruit de rue, large bande',
  },
];

const DENOISE_MODES: { value: DenoiseMode; label: string; hint: string }[] = [
  { value: 'neural', label: 'Neural', hint: 'réseau récurrent, le plus efficace' },
  { value: 'soft', label: 'Doux', hint: 'soustraction spectrale, plus respectueux' },
  { value: 'off', label: 'Aucun', hint: 'pour entendre le reste de la chaîne' },
];

const SWITCHES: { key: keyof PipelineOptions; label: string; detail: string }[] = [
  { key: 'highpass', label: 'Couper les infra-graves', detail: `passe-haut ${HIGHPASS_HZ} Hz` },
  { key: 'deesser', label: 'Adoucir les sifflantes', detail: 'de-esser 5–9 kHz' },
  { key: 'gate', label: 'Fermer les blancs', detail: 'gate adaptatif −18 dB' },
  { key: 'loudness', label: 'Mettre au niveau', detail: `${minus(String(TARGET_LUFS))} LUFS · −1 dBTP` },
];

export function Demo() {
  const processor = useProcessor();
  const player = useAbPlayer();

  const { load: loadPlayer, seek, play, toggle, setSide, side } = player;
  const { result, source, status } = processor;

  // Reprise de la position : changer un réglage relance le traitement, mais ne
  // doit pas ramener l'auditeur au début du fichier.
  const resumeRef = useRef<{ time: number; playing: boolean } | null>(null);
  const wasProcessing = useRef(false);

  useEffect(() => {
    if (status === 'processing' && !wasProcessing.current) {
      wasProcessing.current = true;
      resumeRef.current = { time: player.currentTime, playing: player.playing };
    }
    if (status !== 'processing') wasProcessing.current = false;
    // On ne dépend volontairement que du statut : lire la position à chaque
    // trame de lecture relancerait cet effet soixante fois par seconde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (!result || !source) return;
    loadPlayer(source.samples, result.processed, source.sampleRate, result.loudnessMatchDb);
    const resume = resumeRef.current;
    resumeRef.current = null;
    if (resume && resume.time > 0 && resume.time < source.durationS) {
      seek(resume.time);
      if (resume.playing) play();
    }
  }, [result, source, loadPlayer, seek, play]);

  // Raccourcis clavier. On s'efface dès que le focus est sur un contrôle :
  // Espace doit rester Espace quand on est sur un bouton.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'LABEL'].includes(target.tagName) ||
          target.getAttribute('role') === 'slider')
      ) {
        return;
      }
      if (!result) return;

      if (event.code === 'Space') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        setSide(side === 'original' ? 'processed' : 'original');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, toggle, setSide, side]);

  const setOption = useCallback(
    (partial: Partial<PipelineOptions>) => processor.setOptions(partial),
    [processor],
  );

  const busy = status === 'decoding' || status === 'processing';
  const hasResult = Boolean(result && source);

  return (
    <section className="section demo" id="demo">
      <div className="shell">
        <div className="section__head">
          <p className="kicker">01 — Démonstration</p>
          <div>
            <h2 className="display section__title">Écoutez la différence, sur votre fichier</h2>
            <p className="prose demo__intro">
              Déposez un extrait de voix. Le traitement s’exécute ici, dans cet onglet.
              Ouvrez l’onglet réseau de votre navigateur si vous voulez vérifier&nbsp;:
              rien ne part.
            </p>
          </div>
        </div>

        <Dropzone
          samples={SAMPLES}
          disabled={busy}
          compact={hasResult}
          onFile={processor.acceptFile}
          onSample={processor.acceptUrl}
        />

        {source && (
          <p className="demo__file mono">
            <span className="demo__fileName">{source.name}</span>
            <span>{formatDuration(source.durationS)}</span>
            <span>{formatBytes(source.bytes)}</span>
            <span>{(source.sampleRate / 1000).toFixed(0)} kHz mono</span>
          </p>
        )}

        {processor.notice && (
          <p className="notice demo__notice">
            <span className="notice__label">Note</span>
            <span>{processor.notice}</span>
          </p>
        )}

        {processor.error && (
          <p className="notice notice--alert demo__notice" role="alert">
            <span className="notice__label">Échec</span>
            <span>
              {processor.error}{' '}
              {source && (
                <button type="button" className="demo__retry" onClick={processor.retry}>
                  Réessayer
                </button>
              )}
            </span>
          </p>
        )}

        <ProcessingProgress
          active={busy}
          stage={processor.stage}
          progress={status === 'decoding' ? 0 : processor.progress}
        />

        {hasResult && result && source && (
          <div className="demo__result">
            <div className="demo__stage">
              <AbToggle
                side={player.side}
                onSideChange={player.setSide}
                compensate={player.compensate}
                onCompensateChange={player.setCompensate}
                matchDb={result.loudnessMatchDb}
              />

              {player.error && (
                <p className="notice notice--alert" role="alert">
                  <span className="notice__label">Son</span>
                  <span>{player.error}</span>
                </p>
              )}

              <Transport
                playing={player.playing}
                currentTime={player.currentTime}
                duration={player.duration}
                onToggle={player.toggle}
                onSeek={player.seek}
              />

              <Waveform
                before={result.before}
                after={result.after}
                side={player.side}
                currentTime={player.currentTime}
                duration={player.duration}
                onSeek={player.seek}
              />
            </div>

            <div className="demo__panels">
              <div className="plate demo__chain">
                <div className="plate__head">
                  <h3 className="demo__chainTitle">Chaîne de traitement</h3>
                  <span className="kicker">
                    {result.elapsedMs} ms
                  </span>
                </div>

                <fieldset className="demo__modes" disabled={busy}>
                  <legend className="kicker demo__legend">Débruitage</legend>
                  <div className="demo__modeRow">
                    {DENOISE_MODES.map((mode) => (
                      <label
                        key={mode.value}
                        className="demo__mode"
                        data-checked={processor.options.denoise === mode.value}
                      >
                        <input
                          type="radio"
                          name="denoise"
                          value={mode.value}
                          checked={processor.options.denoise === mode.value}
                          onChange={() => setOption({ denoise: mode.value })}
                        />
                        <span>{mode.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="demo__modeHint">
                    {DENOISE_MODES.find((m) => m.value === processor.options.denoise)?.hint}
                    {result.appliedDenoise !== processor.options.denoise && (
                      <> — appliqué&nbsp;: {result.appliedDenoise}</>
                    )}
                  </p>
                </fieldset>

                <div className="demo__strength">
                  <label htmlFor="strength" className="demo__strengthLabel">
                    Dosage
                    <span className="mono">{Math.round(processor.options.strength * 100)}&thinsp;%</span>
                  </label>
                  <input
                    id="strength"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(processor.options.strength * 100)}
                    disabled={busy || processor.options.denoise === 'off'}
                    onChange={(event) =>
                      setOption({ strength: Number(event.target.value) / 100 })
                    }
                  />
                  <p className="demo__strengthHint">
                    À fond, le fond disparaît complètement — et ça s’entend. On laisse
                    volontairement un peu de pièce.
                  </p>
                </div>

                <ul className="demo__switches">
                  {SWITCHES.map((item) => (
                    <li key={item.key}>
                      <label className="demo__switch">
                        <input
                          type="checkbox"
                          checked={Boolean(processor.options[item.key])}
                          disabled={busy}
                          onChange={(event) =>
                            setOption({ [item.key]: event.target.checked } as Partial<PipelineOptions>)
                          }
                        />
                        <span className="demo__switchLabel">{item.label}</span>
                        <span className="demo__switchDetail mono">{item.detail}</span>
                      </label>
                    </li>
                  ))}
                </ul>

                <div className="demo__export">
                  <DownloadButton
                    samples={result.processed}
                    sampleRate={source.sampleRate}
                    sourceName={source.name}
                  />
                </div>
              </div>

              <MetricsPanel before={result.before} after={result.after} />
            </div>

            <Spectrogram
              before={result.before}
              after={result.after}
              side={player.side}
              currentTime={player.currentTime}
              duration={player.duration}
              matchDb={result.loudnessMatchDb}
            />
          </div>
        )}
      </div>
    </section>
  );
}
