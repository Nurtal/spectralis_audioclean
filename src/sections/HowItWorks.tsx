import { HIGHPASS_HZ, MAX_DURATION_S, TARGET_LUFS, SAMPLE_RATE } from '../lib/constants';
import { minus } from '../lib/format';
import '../styles/components/how.css';

interface Step {
  title: string;
  heard: string;
  done: string;
  spec: string;
}

/*
 * On nomme les choses par ce que l'utilisateur entend. « Souffle de fond »
 * plutôt que « bruit stationnaire large bande ». La ligne technique est là
 * quand même, en petit, pour ceux qui la cherchent — c'est elle qui prouve
 * qu'il y a un métier derrière, mais elle ne parle pas la première.
 */
const STEPS: Step[] = [
  {
    title: 'Lecture du fichier',
    heard: 'Vous déposez, ça démarre. Rien ne part sur le réseau.',
    done: 'Décodage, mixage en mono, rééchantillonnage, troncature à la durée de démo.',
    spec: `${SAMPLE_RATE / 1000} kHz mono · ${MAX_DURATION_S} s max`,
  },
  {
    title: 'Coupe des infra-graves',
    heard: 'Le camion dehors, la climatisation, le choc de la table.',
    done: 'Sous 80 Hz une voix parlée n’a rien à dire : on coupe net, et le débruiteur n’a plus à dépenser son budget là-dessus.',
    spec: `Butterworth ordre 4 · ${HIGHPASS_HZ} Hz`,
  },
  {
    title: 'Retrait du bruit de fond',
    heard: 'Le souffle, le ronflement, la rue. Ce qui reste quand personne ne parle.',
    done: 'Deux chemins au choix : un réseau récurrent entraîné pour la voix, ou une soustraction spectrale maison qui apprend le bruit dans vos blancs.',
    spec: 'RNNoise · ou STFT 2048/512',
  },
  {
    title: 'Adoucissement des sifflantes',
    heard: 'Les « s » qui piquent, souvent renforcés par le débruitage lui-même.',
    done: 'On isole la bande, on mesure son niveau habituel, et on ne rabote que l’excès.',
    spec: 'Bande 5–9 kHz · 4:1 · −12 dB max',
  },
  {
    title: 'Fermeture des blancs',
    heard: 'Les silences deviennent des silences, sans devenir des trous.',
    done: 'Le seuil se déduit du plancher mesuré sur votre fichier. L’atténuation plafonne : une coupure totale s’entend.',
    spec: 'Seuil adaptatif · plage −18 dB',
  },
  {
    title: 'Mise au niveau',
    heard: 'Le fichier sort au volume des plateformes de podcast, sans saturer.',
    done: 'Mesure du loudness intégré, gain global, puis limitation à anticipation sur la crête vraie.',
    spec: `${minus(String(TARGET_LUFS))} LUFS · −1 dBTP`,
  },
];

export function HowItWorks() {
  return (
    <section className="section how" id="methode">
      <div className="shell">
        <div className="section__head">
          <p className="kicker">02 — Méthode</p>
          <div>
            <h2 className="display section__title">Six passages, dans cet ordre</h2>
            <p className="prose">
              L’ordre n’est pas décoratif. On enlève l’inaudible avant de débruiter, on
              débruite avant de comprimer, et on met au niveau en dernier — c’est la seule
              étape qui doit voir le signal fini.
            </p>
          </div>
        </div>

        <ol className="how__list">
          {STEPS.map((step, index) => (
            <li className="how__step" key={step.title}>
              <span className="how__index mono" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="how__body">
                <h3 className="how__title">{step.title}</h3>
                <p className="how__heard">{step.heard}</p>
                <p className="how__done">{step.done}</p>
              </div>
              <span className="how__spec mono">{step.spec}</span>
            </li>
          ))}
        </ol>

        <p className="how__foot prose">
          Le tout tourne dans un <em>worker</em>, à côté de la page&nbsp;: une transformée
          de Fourier sur quatre-vingt-dix secondes d’audio gèlerait l’onglet plusieurs
          secondes. Vous pouvez faire défiler pendant que ça calcule.
        </p>
      </div>
    </section>
  );
}
