import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioAnalysis } from '../audio/types';
import type { AbSide } from '../player/abPlayer';
import { formatDuration } from '../lib/format';
import { cssVar, fitCanvas, hexToRgb, observeSize, rgbString, tween } from '../lib/canvas';
import '../styles/components/waveform.css';

interface Props {
  before: AudioAnalysis;
  after: AudioAnalysis;
  side: AbSide;
  currentTime: number;
  duration: number;
  onSeek: (timeS: number) => void;
}

const HEIGHT = 168;

/**
 * Les deux waveforms superposées.
 *
 * Celle qu'on écoute est pleine et colorée ; l'autre reste en fantôme derrière.
 * On voit donc en permanence ce que le traitement a retiré — c'est plus
 * convaincant qu'un avant/après côte à côte, où l'œil doit faire l'aller-retour.
 *
 * Au changement de côté, les deux fondus s'échangent sur la durée de la
 * bascule. Le canvas ne sait pas faire de transition CSS : on l'anime à la main.
 */
export function Waveform({ before, after, side, currentTime, duration, onSeek }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const mixRef = useRef(side === 'processed' ? 1 : 0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  /** Redessine le fond (les deux waveforms) dans un canvas hors écran. */
  const paintLayer = useCallback(() => {
    const host = wrapRef.current;
    if (!host || width <= 0) return;

    if (!layerRef.current) layerRef.current = document.createElement('canvas');
    const layer = layerRef.current;
    const { ratio } = fitCanvas(layer, width, HEIGHT);
    const ctx = layer.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const noise = hexToRgb(cssVar(host, '--noise'));
    const signal = hexToRgb(cssVar(host, '--signal'));
    const rule = hexToRgb(cssVar(host, '--rule'));
    const mix = mixRef.current;

    // Ligne médiane et repères d'amplitude : c'est un instrument, il a une règle.
    ctx.strokeStyle = rgbString(rule, 0.55);
    ctx.lineWidth = 1;
    for (const fraction of [0.25, 0.5, 0.75]) {
      const y = Math.round(HEIGHT * fraction) + 0.5;
      ctx.globalAlpha = fraction === 0.5 ? 1 : 0.45;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Échelle verticale commune aux deux tracés : sinon la normalisation du
    // traité le ferait paraître « plus gros », ce qui n'est pas une qualité.
    let peak = 0;
    for (const analysis of [before, after]) {
      for (let i = 0; i < analysis.peaks.length; i++) {
        const v = Math.abs(analysis.peaks[i]);
        if (v > peak) peak = v;
      }
    }
    const scale = peak > 0 ? HEIGHT / 2 / peak : 0;

    const drawLayer = (analysis: AudioAnalysis, color: [number, number, number], alpha: number) => {
      if (alpha <= 0.01) return;
      ctx.fillStyle = rgbString(color, alpha);
      const columns = analysis.peakCount;
      const step = width / columns;
      const half = HEIGHT / 2;
      ctx.beginPath();
      for (let c = 0; c < columns; c++) {
        const min = analysis.peaks[c * 2];
        const max = analysis.peaks[c * 2 + 1];
        const x = c * step;
        const top = half - max * scale;
        const bottom = half - min * scale;
        // Au moins un pixel : un silence total doit rester une ligne visible.
        ctx.rect(x, top, Math.max(step, 0.7), Math.max(bottom - top, 1));
      }
      ctx.fill();
    };

    // L'inactive reste présente en filigrane — c'est la comparaison qui compte.
    drawLayer(before, noise, 0.2 + 0.72 * (1 - mix));
    drawLayer(after, signal, 0.2 + 0.72 * mix);
  }, [before, after, width]);

  /** Compose : le fond mis en cache, puis la tête de lecture. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const host = wrapRef.current;
    if (!canvas || !layer || !host || width <= 0) return;

    const { ratio } = fitCanvas(canvas, width, HEIGHT);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (duration > 0) {
      const ink = hexToRgb(cssVar(host, '--ink'));
      const x = Math.round((currentTime / duration) * width) + 0.5;

      // Voile léger sur la partie déjà lue : on sait où on en est sans
      // ajouter une seconde barre de progression.
      ctx.fillStyle = rgbString(ink, 0.06);
      ctx.fillRect(0, 0, x, HEIGHT);

      ctx.strokeStyle = rgbString(ink);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();

      ctx.fillStyle = rgbString(ink);
      ctx.fillRect(x - 3.5, 0, 7, 3);
    }
  }, [currentTime, duration, width]);

  // Redimensionnement.
  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    setWidth(host.clientWidth);
    return observeSize(host, (w) => setWidth(w));
  }, []);

  // Deux effets distincts, et c'est le point : le fond ne se refait que
  // lorsque les analyses ou la largeur changent, la composition à chaque
  // trame. Tout refaire à 60 Hz coûterait 2000 rectangles pour rien.
  const paintRef = useRef(paint);

  useEffect(() => {
    paintRef.current = paint;
    paint();
  }, [paint]);

  useEffect(() => {
    paintLayer();
    paintRef.current();
  }, [paintLayer]);

  // Bascule de côté : on anime le fondu entre les deux tracés.
  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    const target = side === 'processed' ? 1 : 0;
    const from = mixRef.current;
    if (from === target) return;

    const durationMs = Number.parseFloat(cssVar(host, '--ab-transition')) || 0;
    return tween(durationMs, (t) => {
      mixRef.current = from + (target - from) * t;
      paintLayer();
      paint();
    });
  }, [side, paintLayer, paint]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const host = wrapRef.current;
      if (!host || duration <= 0) return;
      const box = host.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (duration <= 0) return;
      const step = event.shiftKey ? 5 : 1;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onSeek(Math.max(0, currentTime - step));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onSeek(Math.min(duration, currentTime + step));
      } else if (event.key === 'Home') {
        event.preventDefault();
        onSeek(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        onSeek(duration);
      }
    },
    [currentTime, duration, onSeek],
  );

  return (
    <div className="waveform">
      <div
        ref={wrapRef}
        className="waveform__stage"
        role="slider"
        tabIndex={0}
        aria-label="Position de lecture"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatDuration(currentTime)} sur ${formatDuration(duration)}`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          seekFromEvent(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging) seekFromEvent(event.clientX);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
      >
        <canvas ref={canvasRef} className="waveform__canvas" aria-hidden="true" />
      </div>

      <div className="waveform__legend mono">
        <span data-active={side === 'original'} className="waveform__key waveform__key--noise">
          Original
        </span>
        <span data-active={side === 'processed'} className="waveform__key waveform__key--signal">
          Traité
        </span>
        <span className="waveform__times">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}
