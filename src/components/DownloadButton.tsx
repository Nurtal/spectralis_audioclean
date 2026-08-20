import { useCallback, useState } from 'react';
import { encodeWavBlob } from '../audio/encode/wav';
import { formatBytes } from '../lib/format';
import '../styles/components/download.css';

interface Props {
  samples: Float32Array;
  sampleRate: number;
  sourceName: string;
}

/** « voix-rue.mp3 » → « voix-rue-nettoye.wav » */
function outputName(sourceName: string): string {
  const base = sourceName.replace(/\.[^./\\]+$/, '') || 'extrait';
  return `${base}-nettoye.wav`;
}

export function DownloadButton({ samples, sampleRate, sourceName }: Props) {
  const [size, setSize] = useState<number | null>(null);

  const download = useCallback(() => {
    const blob = encodeWavBlob(samples, sampleRate);
    setSize(blob.size);

    // Le fichier est fabriqué ici, dans l'onglet, et l'URL ne pointe que sur la
    // mémoire du navigateur. Rien n'est envoyé, rien n'est stocké ailleurs.
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = outputName(sourceName);
    link.click();
    // On rend la mémoire dès que le téléchargement est amorcé.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [samples, sampleRate, sourceName]);

  return (
    <div className="download">
      <button type="button" className="button button--solid" onClick={download}>
        Télécharger le WAV
      </button>
      <p className="download__note mono">
        16&nbsp;bits · {(sampleRate / 1000).toFixed(0)}&nbsp;kHz · mono
        {size !== null && <> · {formatBytes(size)}</>}
      </p>
    </div>
  );
}
