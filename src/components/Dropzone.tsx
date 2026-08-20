import { useCallback, useId, useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, MAX_DURATION_S, MAX_FILE_BYTES } from '../lib/constants';
import { formatBytes } from '../lib/format';
import '../styles/components/dropzone.css';

export interface SampleDescriptor {
  file: string;
  label: string;
  defect: string;
}

interface Props {
  onFile: (file: File) => void;
  onSample: (url: string, name: string) => void;
  samples: SampleDescriptor[];
  disabled?: boolean;
  /** Compact : la zone se replie une fois qu'un fichier est chargé. */
  compact?: boolean;
}

const ACCEPT = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

/**
 * Dépôt de fichier.
 *
 * Trois chemins vers la même chose : glisser, cliquer, ou prendre un extrait
 * fourni. Le troisième compte autant que les deux autres — un visiteur qui n'a
 * pas de fichier sous la main doit pouvoir entendre la démo en un clic.
 */
export function Dropzone({ onFile, onSample, samples, disabled = false, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const inputId = useId();

  const take = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className={`dropzone${compact ? ' dropzone--compact' : ''}`}>
      <div
        className="dropzone__target"
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (!disabled) take(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="visually-hidden"
          accept={ACCEPT}
          disabled={disabled}
          onChange={(event) => {
            take(event.target.files);
            // Redéposer le même fichier doit relancer un traitement.
            event.target.value = '';
          }}
        />

        <div className="dropzone__body">
          <p className="dropzone__lead display">
            {compact ? 'Un autre fichier ?' : 'Déposez un fichier voix'}
          </p>
          <p className="dropzone__or">
            ou{' '}
            <label htmlFor={inputId} className="dropzone__browse">
              parcourez votre disque
            </label>
          </p>
          <p className="dropzone__specs mono">
            {ACCEPTED_EXTENSIONS.join(' · ')} — {formatBytes(MAX_FILE_BYTES)} max —{' '}
            {MAX_DURATION_S}&nbsp;s analysées
          </p>
        </div>
      </div>

      <div className="dropzone__samples">
        <p className="kicker">Ou prenez un de nos extraits</p>
        <ul className="dropzone__list">
          {samples.map((sample) => (
            <li key={sample.file}>
              <button
                type="button"
                className="dropzone__sample"
                disabled={disabled}
                onClick={() =>
                  onSample(new URL(`samples/${sample.file}`, document.baseURI).href, sample.file)
                }
              >
                <span className="dropzone__sampleLabel">{sample.label}</span>
                <span className="dropzone__sampleDefect mono">{sample.defect}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
