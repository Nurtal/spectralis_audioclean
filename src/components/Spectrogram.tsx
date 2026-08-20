import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioAnalysis, SpectrogramData } from '../audio/types';
import type { AbSide } from '../player/abPlayer';
import { formatHz } from '../lib/format';
import { cssVar, fitCanvas, hexToRgb, mixRgb, observeSize, rgbString } from '../lib/canvas';
import '../styles/components/spectrogram.css';

interface Props {
  before: AudioAnalysis;
  after: AudioAnalysis;
  side: AbSide;
  currentTime: number;
  duration: number;
  /** Écart de loudness original − traité, en dB. Voir `matchOffset`. */
  matchDb: number;
}

const HEIGHT = 260;

/**
 * Rampe de couleur : fond de page → couleur du côté → encre.
 *
 * Deux segments plutôt qu'un dégradé linéaire vers le noir : le premier fait
 * apparaître le signal, le second donne du relief aux harmoniques les plus
 * fortes sans que tout se referme en une masse sombre.
 */
function buildRamp(
  base: [number, number, number],
  color: [number, number, number],
  ink: [number, number, number],
): Uint8ClampedArray {
  const ramp = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const rgb =
      t < 0.68 ? mixRgb(base, color, t / 0.68) : mixRgb(color, ink, (t - 0.68) / 0.32);
    ramp[i * 3] = rgb[0];
    ramp[i * 3 + 1] = rgb[1];
    ramp[i * 3 + 2] = rgb[2];
  }
  return ramp;
}

/**
 * Décalage à appliquer à l'image du traité pour la comparer à volume égal.
 *
 * Le traité est normalisé, donc plus fort, donc plus dense à l'écran : sans
 * correction, l'œil lit « plus de signal » là où il n'y a que « plus de gain ».
 * C'est le même piège que pour l'oreille, et il se corrige de la même façon.
 */
function matchOffset(matchDb: number, spec: SpectrogramData): number {
  if (!Number.isFinite(matchDb)) return 0;
  return Math.round((matchDb * 255) / (spec.maxDb - spec.minDb));
}

function renderToCanvas(
  spec: SpectrogramData,
  ramp: Uint8ClampedArray,
  levelOffset = 0,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Une seule ImageData, un seul putImageData. Un fillRect par pixel sur
  // 1400 × 192 points est tout simplement inutilisable.
  const image = ctx.createImageData(spec.width, spec.height);
  const data = image.data;
  for (let i = 0; i < spec.data.length; i++) {
    const shifted = spec.data[i] + levelOffset;
    const v = (shifted < 0 ? 0 : shifted > 255 ? 255 : shifted) * 3;
    const o = i * 4;
    data[o] = ramp[v];
    data[o + 1] = ramp[v + 1];
    data[o + 2] = ramp[v + 2];
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Avant / après en volet coulissant.
 *
 * Les deux spectrogrammes sont exactement superposés ; le volet décide de
 * l'endroit où l'on passe de l'un à l'autre. C'est la seule disposition où
 * l'œil compare deux images au même instant du fichier, sans aller-retour.
 */
export function Spectrogram({ before, after, side, currentTime, duration, matchDb }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [curtain, setCurtain] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const [ramps, setRamps] = useState<{ noise: Uint8ClampedArray; signal: Uint8ClampedArray } | null>(
    null,
  );

  // Les rampes dépendent des variables CSS : on les lit une fois montés.
  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    const base = hexToRgb(cssVar(host, '--paper'));
    const ink = hexToRgb(cssVar(host, '--ink'));
    setRamps({
      noise: buildRamp(base, hexToRgb(cssVar(host, '--noise')), ink),
      signal: buildRamp(base, hexToRgb(cssVar(host, '--signal')), ink),
    });
  }, []);

  const layers = useMemo(() => {
    if (!ramps) return null;
    return {
      before: renderToCanvas(before.spectrogram, ramps.noise),
      after: renderToCanvas(after.spectrogram, ramps.signal, matchOffset(matchDb, after.spectrogram)),
    };
  }, [before, after, ramps, matchDb]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const host = wrapRef.current;
    if (!canvas || !host || !layers || width <= 0) return;

    const { ratio } = fitCanvas(canvas, width, HEIGHT);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    // Lissage actif : on agrandit une image de 1400 colonnes, l'escalier de
    // pixels raconterait une précision qu'on n'a pas.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const split = Math.round(width * curtain);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, split, HEIGHT);
    ctx.clip();
    ctx.drawImage(layers.before, 0, 0, width, HEIGHT);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(split, 0, width - split, HEIGHT);
    ctx.clip();
    ctx.drawImage(layers.after, 0, 0, width, HEIGHT);
    ctx.restore();

    const ink = hexToRgb(cssVar(host, '--ink'));
    const card = hexToRgb(cssVar(host, '--card'));

    // Le trait du volet, en encre sur un liseré clair pour rester lisible des
    // deux côtés quelle que soit la densité du spectre.
    ctx.strokeStyle = rgbString(card, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(split + 0.5, 0);
    ctx.lineTo(split + 0.5, HEIGHT);
    ctx.stroke();
    ctx.strokeStyle = rgbString(ink);
    ctx.lineWidth = 1;
    ctx.stroke();

    if (duration > 0) {
      const x = Math.round((currentTime / duration) * width) + 0.5;
      ctx.strokeStyle = rgbString(ink, 0.75);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [layers, width, curtain, currentTime, duration]);

  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    setWidth(host.clientWidth);
    return observeSize(host, (w) => setWidth(w));
  }, []);

  useEffect(() => {
    paint();
  }, [paint]);

  const moveCurtain = useCallback((clientX: number) => {
    const host = wrapRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    setCurtain(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  }, []);

  const spec = before.spectrogram;
  // Trois repères de fréquence, aux décades — l'axe est logarithmique.
  const ticks = useMemo(() => {
    const values = [100, 1000, 10_000].filter((hz) => hz > spec.minHz && hz < spec.maxHz);
    return values.map((hz) => ({
      hz,
      // 0 % en haut = fréquence maximale.
      top: (1 - Math.log(hz / spec.minHz) / Math.log(spec.maxHz / spec.minHz)) * 100,
    }));
  }, [spec]);

  return (
    <div className="spectro">
      <div className="spectro__frame">
        <div className="spectro__axis mono" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.hz} style={{ top: `${tick.top}%` }}>
              {formatHz(tick.hz)}
            </span>
          ))}
        </div>

        <div ref={wrapRef} className="spectro__stage">
          <canvas ref={canvasRef} className="spectro__canvas" aria-hidden="true" />

          <div
            className="spectro__handle"
            style={{ left: `${curtain * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Position du volet de comparaison"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(curtain * 100)}
            aria-valuetext={`${Math.round(curtain * 100)} % d’original à gauche`}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.1 : 0.02;
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setCurtain((c) => Math.max(0, c - step));
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                setCurtain((c) => Math.min(1, c + step));
              } else if (event.key === 'Home') {
                event.preventDefault();
                setCurtain(0);
              } else if (event.key === 'End') {
                event.preventDefault();
                setCurtain(1);
              }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }}
            onPointerMove={(event) => {
              if (dragging) moveCurtain(event.clientX);
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setDragging(false);
            }}
            onPointerCancel={() => setDragging(false)}
          >
            <span className="spectro__grip" aria-hidden="true" />
          </div>

          <span className="spectro__tag spectro__tag--left mono" data-active={side === 'original'}>
            Original
          </span>
          <span className="spectro__tag spectro__tag--right mono" data-active={side === 'processed'}>
            Traité
          </span>
        </div>
      </div>

      <p className="spectro__caption">
        Tirez le volet pour déplacer la frontière. En bleu&nbsp;: le fichier d’origine.
        En ambre&nbsp;: après traitement, ramené au même niveau — sinon le gain de
        normalisation se lirait comme du signal en plus. Les nappes horizontales qui
        disparaissent sont le bruit&nbsp;; les traits qui restent sont la voix.
      </p>
    </div>
  );
}
