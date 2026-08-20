import type { StageName } from '../audio/types';
import { STAGE_LABELS } from '../audio/types';
import '../styles/components/progress.css';

interface Props {
  stage: StageName | null;
  progress: number;
  /** Les étapes déjà franchies restent affichées : on montre le chemin. */
  active: boolean;
}

const ORDER: StageName[] = [
  'analyse-source',
  'passe-haut',
  'debruitage',
  'de-esser',
  'gate',
  'normalisation',
  'analyse-resultat',
];

export function ProcessingProgress({ stage, progress, active }: Props) {
  if (!active) return null;
  const currentIndex = stage ? ORDER.indexOf(stage) : -1;
  const percent = Math.round(progress * 100);

  return (
    <div
      className="progress"
      role="status"
      aria-live="polite"
      aria-label={`Traitement en cours : ${stage ? STAGE_LABELS[stage] : 'préparation'}, ${percent} %`}
    >
      <div className="progress__head">
        <span className="progress__stage">
          {stage ? STAGE_LABELS[stage] : 'Préparation'}
        </span>
        <span className="mono progress__percent">{percent}&thinsp;%</span>
      </div>

      <div className="progress__track">
        <div className="progress__fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <ol className="progress__steps mono">
        {ORDER.map((name, index) => (
          <li
            key={name}
            className="progress__step"
            data-state={
              index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
            }
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
