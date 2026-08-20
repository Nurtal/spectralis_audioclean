import { useId } from 'react';
import type { AbSide } from '../player/abPlayer';
import { formatDelta } from '../lib/format';
import '../styles/components/ab-toggle.css';

interface Props {
  side: AbSide;
  onSideChange: (side: AbSide) => void;
  compensate: boolean;
  onCompensateChange: (enabled: boolean) => void;
  /** Écart de loudness mesuré entre l'original et le traité, en dB. */
  matchDb: number;
  disabled?: boolean;
}

/**
 * La bascule.
 *
 * Deux boutons radio, pas un interrupteur : les flèches du clavier
 * fonctionnent sans qu'on ait à les recoder, et un lecteur d'écran annonce les
 * deux positions au lieu d'un « activé / désactivé » qui ne veut rien dire ici.
 *
 * La couleur bascule en même temps que le son. C'est le seul endroit de la page
 * où l'on dépense de la couleur, et c'est volontaire : le froid devient chaud
 * au moment où le bruit disparaît.
 */
export function AbToggle({
  side,
  onSideChange,
  compensate,
  onCompensateChange,
  matchDb,
  disabled = false,
}: Props) {
  const groupId = useId();
  const compensateId = useId();

  return (
    <div className="ab">
      <fieldset className="ab__group" data-side={side} disabled={disabled}>
        <legend className="visually-hidden">Source écoutée</legend>

        <span className="ab__slider" aria-hidden="true" />

        {(['original', 'processed'] as const).map((value) => (
          <div className="ab__option" key={value}>
            <input
              type="radio"
              id={`${groupId}-${value}`}
              name={groupId}
              value={value}
              checked={side === value}
              onChange={() => onSideChange(value)}
              className="ab__input"
            />
            <label htmlFor={`${groupId}-${value}`} className="ab__label">
              {value === 'original' ? 'Original' : 'Traité'}
            </label>
          </div>
        ))}
      </fieldset>

      <div className="ab__aside">
        <label className="ab__compensate" htmlFor={compensateId}>
          <input
            type="checkbox"
            id={compensateId}
            checked={compensate}
            onChange={(event) => onCompensateChange(event.target.checked)}
            disabled={disabled}
          />
          <span>Comparer à volume égal</span>
        </label>
        <p className="ab__explain">
          Le fichier traité est normalisé, donc plus fort. Sans compensation,
          «&nbsp;plus fort&nbsp;» s’entend comme «&nbsp;meilleur&nbsp;».{' '}
          {Number.isFinite(matchDb) && matchDb !== 0 && (
            <span className="mono ab__match">
              {formatDelta(matchDb)}&nbsp;dB appliqués
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
