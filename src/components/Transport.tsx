import { formatDuration } from '../lib/format';
import '../styles/components/transport.css';

interface Props {
  playing: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (timeS: number) => void;
  disabled?: boolean;
}

export function Transport({
  playing,
  currentTime,
  duration,
  onToggle,
  onSeek,
  disabled = false,
}: Props) {
  return (
    <div className="transport">
      <button
        type="button"
        className="transport__play"
        onClick={onToggle}
        disabled={disabled}
        aria-label={playing ? 'Pause' : 'Écouter'}
      >
        <span aria-hidden="true" className={playing ? 'glyph glyph--pause' : 'glyph glyph--play'} />
        <span className="transport__playLabel">{playing ? 'Pause' : 'Écouter'}</span>
      </button>

      <button
        type="button"
        className="button button--quiet"
        onClick={() => onSeek(0)}
        disabled={disabled || currentTime === 0}
        aria-label="Revenir au début"
      >
        ⟲ Début
      </button>

      <p className="transport__time mono" aria-hidden="true">
        <span className="transport__now">{formatDuration(currentTime)}</span>
        <span className="transport__sep">/</span>
        <span className="transport__total">{formatDuration(duration)}</span>
      </p>

      <p className="transport__hint mono">
        <kbd>Espace</kbd> lecture · <kbd>B</kbd> bascule
      </p>
    </div>
  );
}
