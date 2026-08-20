import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioAnalysis, DecodedAudio, DenoiseMode, PipelineOptions, StageName } from '../audio/types';
import { DEFAULT_OPTIONS } from '../audio/types';
import { DecodeError, decodeFile, decodeUrl } from '../audio/decode';
import type { FromWorker, ToWorker } from '../workers/protocol';

export type ProcessorStatus = 'idle' | 'decoding' | 'processing' | 'done' | 'error';

export interface ProcessorResult {
  processed: Float32Array;
  before: AudioAnalysis;
  after: AudioAnalysis;
  appliedDenoise: DenoiseMode;
  loudnessMatchDb: number;
  elapsedMs: number;
}

export interface ProcessorState {
  status: ProcessorStatus;
  source: DecodedAudio | null;
  result: ProcessorResult | null;
  stage: StageName | null;
  progress: number;
  error: string | null;
  /** Information non bloquante : troncature, repli sur le mode doux… */
  notice: string | null;
  options: PipelineOptions;
}

/**
 * URL du module RNNoise, résolue contre l'adresse de la page.
 *
 * `document.baseURI` connaît le sous-chemin réel du déploiement — racine de
 * domaine, sous-dossier GitHub Pages, peu importe. Le worker, lui, ne le sait
 * pas : son propre script vit dans `assets/`.
 */
function rnnoiseUrl(): string {
  return new URL('wasm/rnnoise/rnnoise.js', document.baseURI).href;
}

/**
 * Cycle de vie du worker et état de la démo.
 *
 * Le worker survit aux traitements successifs : le recréer coûterait un
 * rechargement du module WASM à chaque changement de réglage.
 */
export function useProcessor() {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const sourceRef = useRef<DecodedAudio | null>(null);
  // Les réglages sont aussi tenus dans une ref : lancer le worker depuis une
  // fonction de mise à jour d'état serait un effet de bord dans un réducteur,
  // et React est en droit de l'appeler deux fois.
  const optionsRef = useRef<PipelineOptions>(DEFAULT_OPTIONS);

  const [state, setState] = useState<ProcessorState>({
    status: 'idle',
    source: null,
    result: null,
    stage: null,
    progress: 0,
    error: null,
    notice: null,
    options: DEFAULT_OPTIONS,
  });

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/process.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        // Un résultat périmé — l'utilisateur a changé de réglage entre-temps.
        if (message.id !== requestIdRef.current) return;

        if (message.type === 'progress') {
          setState((s) => ({ ...s, stage: message.stage, progress: message.progress }));
          return;
        }

        if (message.type === 'error') {
          setState((s) => ({
            ...s,
            status: 'error',
            error: `Le traitement a échoué : ${message.message}`,
          }));
          return;
        }

        setState((s) => ({
          ...s,
          status: 'done',
          progress: 1,
          stage: null,
          error: null,
          notice: message.denoiseNotice ?? s.notice,
          result: {
            processed: message.processed,
            before: message.before,
            after: message.after,
            appliedDenoise: message.appliedDenoise,
            loudnessMatchDb: message.loudnessMatchDb,
            elapsedMs: message.elapsedMs,
          },
        }));
      };
      workerRef.current.onerror = (event) => {
        setState((s) => ({
          ...s,
          status: 'error',
          error: `Le moteur de traitement n'a pas démarré (${event.message || 'erreur inconnue'}).`,
        }));
      };
    }
    return workerRef.current;
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const process = useCallback(
    (decoded: DecodedAudio, options: PipelineOptions) => {
      const worker = getWorker();
      const id = ++requestIdRef.current;
      setState((s) => ({ ...s, status: 'processing', stage: null, progress: 0, error: null }));

      // On transfère une copie : l'original reste sur le thread principal pour
      // alimenter le lecteur A/B, et le transfert évite de payer une seconde
      // copie à l'entrée du worker.
      const copy = decoded.samples.slice();
      const message: ToWorker = {
        type: 'process',
        id,
        samples: copy,
        sampleRate: decoded.sampleRate,
        options,
        rnnoiseUrl: rnnoiseUrl(),
      };
      worker.postMessage(message, [copy.buffer as ArrayBuffer]);
    },
    [getWorker],
  );

  const accept = useCallback(
    async (load: () => Promise<DecodedAudio>) => {
      requestIdRef.current++;
      setState((s) => ({
        ...s,
        status: 'decoding',
        result: null,
        source: null,
        error: null,
        notice: null,
        stage: null,
        progress: 0,
      }));

      try {
        const decoded = await load();
        sourceRef.current = decoded;
        const notice = decoded.truncated
          ? `Fichier de ${Math.round(decoded.originalDurationS)} s — la démo n'en traite que les 90 premières secondes.`
          : null;
        setState((s) => ({ ...s, source: decoded, notice, status: 'processing' }));
        process(decoded, optionsRef.current);
      } catch (error) {
        const message =
          error instanceof DecodeError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Fichier illisible.';
        sourceRef.current = null;
        setState((s) => ({ ...s, status: 'error', error: message, source: null }));
      }
    },
    [process],
  );

  const acceptFile = useCallback((file: File) => accept(() => decodeFile(file)), [accept]);

  const acceptUrl = useCallback(
    (url: string, name: string) => accept(() => decodeUrl(url, name)),
    [accept],
  );

  /** Change les réglages et relance le traitement sans redécoder le fichier. */
  const setOptions = useCallback(
    (partial: Partial<PipelineOptions>) => {
      const options = { ...optionsRef.current, ...partial };
      optionsRef.current = options;
      setState((s) => ({ ...s, options, notice: null }));
      const source = sourceRef.current;
      if (source) process(source, options);
    },
    [process],
  );

  const reset = useCallback(() => {
    requestIdRef.current++;
    sourceRef.current = null;
    setState((s) => ({
      ...s,
      status: 'idle',
      source: null,
      result: null,
      stage: null,
      progress: 0,
      error: null,
      notice: null,
    }));
  }, []);

  const retry = useCallback(() => {
    const source = sourceRef.current;
    if (source) process(source, optionsRef.current);
  }, [process]);

  return { ...state, acceptFile, acceptUrl, setOptions, reset, retry };
}
