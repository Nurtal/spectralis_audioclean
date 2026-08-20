import type { AudioAnalysis, Metrics } from '../audio/types';
import { formatDelta, formatLufs, formatDb, formatRatio, minus } from '../lib/format';
import { TARGET_LUFS, TRUE_PEAK_CEILING_DBTP } from '../lib/constants';
import '../styles/components/metrics.css';

interface Props {
  before: AudioAnalysis;
  after: AudioAnalysis;
}

interface Row {
  label: string;
  hint: string;
  unit: string;
  value: (m: Metrics) => number;
  format: (v: number) => string;
  /** Décimales de l'écart : il doit être aussi précis que la valeur. */
  deltaDigits?: number;
  /** Sens de l'amélioration : +1 si monter est mieux, -1 si descendre est mieux. */
  better: 1 | -1 | 0;
}

/*
 * Les libellés disent ce que l'utilisateur entend, pas ce que l'algorithme
 * calcule. « Souffle de fond » plutôt que « plancher de bruit percentile 10 » —
 * la précision technique va dans l'infobulle, pas dans la colonne de gauche.
 */
const ROWS: Row[] = [
  {
    label: 'Niveau perçu',
    hint: `Loudness intégré BS.1770. Cible du traitement : ${minus(String(TARGET_LUFS))} LUFS.`,
    unit: 'LUFS',
    value: (m) => m.lufs,
    format: formatLufs,
    better: 0,
  },
  {
    label: 'Souffle de fond',
    hint: 'Niveau de ce qu’on entend entre les mots. Plus bas, plus propre.',
    unit: 'dBFS',
    value: (m) => m.noiseFloorDb,
    format: (v) => formatDb(v),
    better: -1,
  },
  {
    label: 'Voix au-dessus du fond',
    hint: 'Écart entre la parole et les blancs. Plus haut, plus détaché.',
    unit: 'dB',
    value: (m) => m.snrDb,
    format: (v) => formatDb(v),
    better: 1,
  },
  {
    label: 'Crête vraie',
    hint: `Crête inter-échantillon, ×4. Plafond du traitement : ${minus(String(TRUE_PEAK_CEILING_DBTP))} dBTP.`,
    unit: 'dBTP',
    value: (m) => m.truePeakDb,
    format: (v) => formatDb(v),
    better: 0,
  },
  {
    label: 'Dynamique restante',
    hint: 'Écart crête / moyenne. Trop bas, le son est écrasé.',
    unit: 'dB',
    value: (m) => m.crestFactorDb,
    format: (v) => formatDb(v),
    better: 0,
  },
  {
    label: 'Décalage continu',
    hint: 'Composante continue résiduelle. Doit rester nulle.',
    unit: '',
    value: (m) => m.dcOffset,
    format: (v) => formatRatio(v, 4),
    deltaDigits: 4,
    better: 0,
  },
];

export function MetricsPanel({ before, after }: Props) {
  return (
    <div className="plate metrics">
      <div className="plate__head">
        <h3 className="metrics__title">Mesures</h3>
        <span className="kicker">avant → après</span>
      </div>

      <div className="metrics__scroll">
        <table className="metrics__table">
        <caption className="visually-hidden">
          Comparaison des mesures acoustiques avant et après traitement.
        </caption>
        <thead>
          <tr>
            <th scope="col">Grandeur</th>
            <th scope="col" className="metrics__num">Avant</th>
            <th scope="col" className="metrics__num">Après</th>
            <th scope="col" className="metrics__num">Écart</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const a = row.value(before.metrics);
            const b = row.value(after.metrics);
            const delta = b - a;
            const digits = row.deltaDigits ?? 1;
            const direction =
              row.better === 0 || !Number.isFinite(delta) || Math.abs(delta) < 0.05
                ? 'flat'
                : delta * row.better > 0
                  ? 'better'
                  : 'worse';

            return (
              <tr key={row.label}>
                <th scope="row">
                  <span className="metrics__label">{row.label}</span>
                  <span className="metrics__hint">{row.hint}</span>
                </th>
                <td className="mono metrics__num metrics__before">{row.format(a)}</td>
                <td className="mono metrics__num metrics__after">{row.format(b)}</td>
                <td className="mono metrics__num" data-direction={direction}>
                  {formatDelta(delta, digits)}
                  {row.unit && <span className="metrics__unit"> {row.unit}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>

      <p className="metrics__foot">
        <span className="kicker">Parole détectée</span>{' '}
        <span className="mono">
          {Math.round(before.speechRatio * 100)}&thinsp;% du fichier, en{' '}
          {before.vad.length} segment{before.vad.length > 1 ? 's' : ''}
        </span>
      </p>
    </div>
  );
}
