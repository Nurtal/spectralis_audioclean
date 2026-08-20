import { useCallback, useEffect, useRef, useState } from 'react';
import { AbPlayer, type AbSide } from './abPlayer';

export interface AbPlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  side: AbSide;
  compensate: boolean;
  /** Renseigné si le navigateur a refusé de démarrer la sortie audio. */
  error: string | null;
}

export interface AbPlayerControls extends AbPlayerState {
  load(original: Float32Array, processed: Float32Array, sampleRate: number, matchDb: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(timeS: number): void;
  setSide(side: AbSide): void;
  setCompensate(enabled: boolean): void;
  reset(): void;
}

/**
 * Adaptation React du lecteur.
 *
 * La tête de lecture est animée en `requestAnimationFrame`, et seulement
 * pendant la lecture. Un `setInterval` dériverait de l'horloge audio et ferait
 * trembler le curseur ; et laisser tourner la boucle à l'arrêt réveille le GPU
 * pour rien.
 */
export function useAbPlayer(): AbPlayerControls {
  const playerRef = useRef<AbPlayer | null>(null);
  const frameRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [side, setSideState] = useState<AbSide>('processed');
  const [compensate, setCompensateState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Les réglages passent par des refs pour que `load` garde une identité
  // stable : sinon changer de côté rechargerait les tampons et remettrait la
  // lecture à zéro, ce qui est exactement l'inverse du but.
  const sideRef = useRef<AbSide>('processed');
  const compensateRef = useRef(true);

  const getPlayer = useCallback((): AbPlayer => {
    if (!playerRef.current) {
      playerRef.current = new AbPlayer({
        onEnded: () => {
          setPlaying(false);
          setCurrentTime(0);
          playerRef.current?.seek(0);
        },
      });
    }
    return playerRef.current;
  }, []);

  const stopFrames = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const startFrames = useCallback(() => {
    stopFrames();
    const tick = () => {
      const player = playerRef.current;
      if (!player) return;
      setCurrentTime(player.currentTime);
      if (player.playing) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        setPlaying(false);
      }
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [stopFrames]);

  useEffect(
    () => () => {
      stopFrames();
      playerRef.current?.destroy();
      playerRef.current = null;
    },
    [stopFrames],
  );

  const load = useCallback<AbPlayerControls['load']>(
    (original, processed, sampleRate, matchDb) => {
      const player = getPlayer();
      player.load(original, processed, sampleRate, matchDb);
      player.setSide(sideRef.current);
      player.setCompensate(compensateRef.current);
      setDuration(player.duration);
      setCurrentTime(0);
      setPlaying(false);
    },
    [getPlayer],
  );

  const play = useCallback(() => {
    const player = getPlayer();
    if (!player.ready) return;
    player.play().then(
      () => {
        setError(null);
        setPlaying(true);
        startFrames();
      },
      (cause: unknown) => {
        // Un échec de démarrage doit se voir. Laisser le bouton sur « Pause »
        // et la tête de lecture immobile ferait croire à une panne de son.
        setPlaying(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [getPlayer, startFrames]);

  const pause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    setPlaying(false);
    setCurrentTime(player.currentTime);
    stopFrames();
  }, [stopFrames]);

  const toggle = useCallback(() => {
    if (playerRef.current?.playing) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback((timeS: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seek(timeS);
    setCurrentTime(player.currentTime);
  }, []);

  const setSide = useCallback((next: AbSide) => {
    sideRef.current = next;
    setSideState(next);
    playerRef.current?.setSide(next);
  }, []);

  const setCompensate = useCallback((enabled: boolean) => {
    compensateRef.current = enabled;
    setCompensateState(enabled);
    playerRef.current?.setCompensate(enabled);
  }, []);

  const reset = useCallback(() => {
    stopFrames();
    playerRef.current?.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [stopFrames]);

  return {
    playing,
    currentTime,
    duration,
    side,
    compensate,
    error,
    load,
    play,
    pause,
    toggle,
    seek,
    setSide,
    setCompensate,
    reset,
  };
}
