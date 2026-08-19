# Démo de débruitage audio — 100 % navigateur

Site vitrine statique pour une auto-entreprise de traitement audio. Le cœur du site est une
démo interactive : l'utilisateur dépose un fichier voix, le traitement s'exécute **entièrement
dans son navigateur**, et il compare l'avant/après en A/B instantané avec les analyses à l'appui.

> **L'argument produit :** le fichier ne quitte jamais la machine du visiteur. Pas d'upload,
> pas de serveur, pas de RGPD. C'est à la fois la contrainte technique et le pitch commercial —
> il doit être visible dès le hero, pas relégué dans une mention légale.

---

## 1. Contraintes non négociables

| Contrainte | Détail |
|---|---|
| **Statique** | Aucun backend. Build → dossier de fichiers servis tels quels (Netlify / Cloudflare Pages / GitHub Pages). |
| **Zéro upload** | Aucune requête réseau ne contient de données audio. À vérifier explicitement à la fin. |
| **Pas de `SharedArrayBuffer`** | On évite `ffmpeg.wasm` et le WASM threadé → pas d'en-têtes COOP/COEP → hébergeable partout, GitHub Pages inclus. RNNoise mono-thread suffit. |
| **Durée analysée plafonnée** | 90 s max (`MAX_DURATION_S`). Au-delà, on tronque et on l'annonce clairement : « démo limitée à 90 s — pour vos fichiers complets, parlons-en ». La limite est autant une protection perf qu'un appel à l'action. |
| **Taille de fichier** | 50 Mo max, rejet propre au-delà. |
| **Budget bundle** | < 300 Ko JS gzip hors WASM. Le WASM RNNoise (~150–250 Ko) est chargé **à la demande**, jamais au premier paint. |

---

## 2. Stack

- **Vite** + **TypeScript** (strict) + **React 18**
- **CSS natif** avec custom properties. Pas de Tailwind, pas de CSS-in-JS.
- **Web Audio API** (`OfflineAudioContext` pour le rendu hors temps réel)
- **RNNoise** compilé en WASM pour le débruitage neuronal
- Un **Web Worker** pour tout le DSP lourd
- Aucune dépendance UI lourde. Les canvas (waveform, spectrogramme) sont écrits à la main —
  pas de wavesurfer.js, on veut maîtriser le rendu et le budget.

---

## 3. Arborescence

```
.
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── samples/                    # 3 extraits de démo (~20 s, mp3 64 kbps mono)
│   │   ├── interview-clim.mp3      #   ronflement de climatisation
│   │   ├── podcast-souffle.mp3     #   souffle de préampli + bouche
│   │   └── voix-rue.mp3            #   bruit de fond urbain large bande
│   └── wasm/
│       └── rnnoise/                # .wasm + glue JS, copiés au build (cf. §7)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── audio/                      # ⚠️ ZÉRO import React ici. TS pur, testable au node.
│   │   ├── types.ts                #   AudioAnalysis, ProcessResult, PipelineOptions…
│   │   ├── decode.ts               #   File → AudioBuffer (mono, 48 kHz)
│   │   ├── pipeline.ts             #   orchestration : enchaîne les étapes, émet la progression
│   │   ├── stages/
│   │   │   ├── highpass.ts         #   passe-haut 80 Hz, Butterworth ordre 4
│   │   │   ├── denoise.ts          #   RNNoise, ou spectralGate en repli
│   │   │   ├── spectralGate.ts     #   soustraction spectrale maison (cf. §6)
│   │   │   ├── deesser.ts          #   compression bande 5–9 kHz
│   │   │   ├── gate.ts             #   noise gate à seuil adaptatif
│   │   │   └── loudness.ts         #   normalisation à -16 LUFS, true peak -1 dBTP
│   │   ├── analysis/
│   │   │   ├── fft.ts              #   FFT radix-2 in-place, réutilisable, sans alloc
│   │   │   ├── window.ts           #   Hann, Hamming
│   │   │   ├── peaks.ts            #   AudioBuffer → paires min/max par bucket (waveform)
│   │   │   ├── spectrogram.ts      #   STFT → matrice de magnitudes en dB
│   │   │   ├── noiseFloor.ts       #   estimation du plancher de bruit (percentile 10)
│   │   │   ├── vad.ts              #   détection d'activité vocale → segments parole/silence
│   │   │   └── metrics.ts          #   LUFS (BS.1770), true peak, SNR estimé, crest factor
│   │   ├── rnnoise/
│   │   │   ├── loader.ts           #   chargement paresseux du module WASM
│   │   │   └── rnnoise.ts          #   wrapper : Float32Array → Float32Array
│   │   └── encode/
│   │       └── wav.ts              #   AudioBuffer → Blob WAV 16 bits PCM
│   │
│   ├── workers/
│   │   ├── process.worker.ts       #   reçoit les samples, exécute pipeline + analyses
│   │   └── protocol.ts             #   types des messages, partagés main ↔ worker
│   │
│   ├── player/
│   │   ├── abPlayer.ts             #   moteur de lecture A/B (classe, hors React)
│   │   └── useAbPlayer.ts          #   hook d'adaptation React
│   │
│   ├── components/
│   │   ├── Dropzone.tsx            #   drag & drop + <input file> + boutons échantillons
│   │   ├── AbToggle.tsx            #   bascule Original / Traité — l'élément signature
│   │   ├── Waveform.tsx            #   canvas, les deux waveforms superposées
│   │   ├── Spectrogram.tsx         #   canvas, avant/après en volet coulissant
│   │   ├── Transport.tsx           #   play/pause, tête de lecture, temps
│   │   ├── MetricsPanel.tsx        #   tableau de chiffres avant/après
│   │   ├── ProcessingProgress.tsx  #   étape en cours + barre
│   │   └── DownloadButton.tsx      #   export WAV du résultat
│   │
│   ├── sections/
│   │   ├── Hero.tsx
│   │   ├── Demo.tsx                #   assemble Dropzone + Player + Analyses
│   │   ├── HowItWorks.tsx          #   les étapes du pipeline, expliquées
│   │   ├── Services.tsx
│   │   └── Contact.tsx
│   │
│   ├── hooks/
│   │   └── useProcessor.ts         #   cycle de vie du worker, état de la démo
│   │
│   ├── lib/
│   │   ├── constants.ts            #   MAX_DURATION_S, TARGET_LUFS, SAMPLE_RATE…
│   │   └── format.ts               #   formatage dB, LUFS, durées
│   │
│   └── styles/
│       ├── tokens.css              #   variables CSS (cf. §8)
│       ├── base.css                #   reset, typo, layout de base
│       └── components/*.css
│
└── docs/
    ├── dsp-notes.md                # choix d'algos, constantes, sources
    └── design.md                   # direction visuelle, décisions et refus
```

---

## 4. Flux de données

```
File
 └─▶ decode.ts            AudioContext.decodeAudioData → downmix mono
                          → OfflineAudioContext(1, n, 48000) pour rééchantillonner
                          → troncature à MAX_DURATION_S
 └─▶ postMessage(Float32Array.buffer, [transfer])   ← transférable, pas de copie
      │
      │  ══════ Web Worker ══════
      │
      ├─▶ analysis (source)      peaks, spectrogramme, métriques, plancher de bruit, VAD
      ├─▶ pipeline               highpass → denoise → deesser → gate → loudness
      │                          émet { stage, progress } à chaque étape
      └─▶ analysis (traité)      mêmes mesures, pour comparaison
      │
      └─▶ postMessage({ processed, analysisBefore, analysisAfter }, [transfers])
 │
 └─▶ useProcessor → état React
      ├─▶ AbPlayer   (recrée deux AudioBuffer côté main thread)
      ├─▶ Waveform / Spectrogram / MetricsPanel
      └─▶ encode/wav.ts → Blob → URL.createObjectURL → téléchargement
```

**Protocole worker** — à définir dans `workers/protocol.ts`, discriminé par `type` :

```ts
type ToWorker =
  | { type: 'process'; samples: Float32Array; sampleRate: number; options: PipelineOptions };

type FromWorker =
  | { type: 'progress'; stage: StageName; progress: number }   // 0..1
  | { type: 'done'; processed: Float32Array; before: AudioAnalysis; after: AudioAnalysis }
  | { type: 'error'; message: string; recoverable: boolean };
```

Toujours transférer les `ArrayBuffer` (`postMessage(msg, [buf])`), jamais les cloner.

---

## 5. Le lecteur A/B — le détail qui fait tout

C'est l'élément qui vend. Il doit être **irréprochable** : si la bascule claque ou décale,
la démo perd toute crédibilité.

Implémentation dans `player/abPlayer.ts` :

- **Deux** `AudioBufferSourceNode` (original, traité) démarrés au **même instant**, chacun
  dans son `GainNode`, les deux vers la destination.
- La bascule ne stoppe rien : elle crossfade les deux gains sur **~12 ms** avec
  `setTargetAtTime`. Coupure sèche = clic audible.
- **Compensation de loudness** : le traité est normalisé, donc plus fort. Sans compensation,
  « plus fort » se confond avec « meilleur ». Appliquer un gain de match calculé depuis les
  LUFS mesurés, et offrir une case « comparer à volume égal » cochée par défaut.
- Le repositionnement (clic sur la waveform) recrée les deux sources au même offset.
- La tête de lecture se lit via `AudioContext.currentTime - startTime`, animée en `rAF`.
  Ne jamais piloter le rendu canvas par un `setInterval`.

---

## 6. Débruitage : deux chemins

**Chemin principal — RNNoise (WASM).** Réseau récurrent entraîné pour la voix, excellent sur
le bruit stationnaire *et* non stationnaire, temps de calcul très inférieur au temps réel.

**Chemin de repli — `spectralGate.ts`, écrit à la main.** À implémenter en premier, parce
qu'il ne dépend de rien et débloque tout le reste du site pendant que l'intégration WASM
se règle. Il reste utile en production comme mode « doux » :

1. STFT, fenêtre Hann 2048, hop 512.
2. Profil de bruit : par bin, percentile 10 des magnitudes sur toute la durée
   (ou sur les segments marqués non-parole par le VAD si disponible).
3. Masque : `gain = max(0, (mag - β·noise) / mag)`, β ≈ 1.5, gain plancher à -18 dB
   pour éviter les « musical noise ».
4. Lissage du masque sur 3 trames et 3 bins.
5. ISTFT, overlap-add avec fenêtre de synthèse.

Exposer les deux dans l'UI (`Neural` / `Doux`) : montrer qu'il y a un choix de traitement,
c'est montrer qu'il y a un métier derrière.

---

## 7. Pièges connus — à lire avant de coder

- **RNNoise attend une échelle en `int16`**, pas `[-1, 1]`. Multiplier par 32768 en entrée,
  diviser en sortie. Erreur classique : on obtient du silence ou de la saturation totale.
- **RNNoise est figé à 48 kHz mono, trames de 480 échantillons.** Rééchantillonner en amont,
  et gérer la dernière trame partielle par zéro-padding.
- **Le module npm de RNNoise est à vérifier avant de s'engager** — l'API et le nom du paquet
  varient selon les portages (`@jitsi/rnnoise-wasm` et consorts). Vérifier la signature réelle
  du module et sa licence avant de câbler `rnnoise/loader.ts`, et isoler tout l'appel derrière
  le wrapper pour que le reste du code n'en dépende pas.
- **`decodeAudioData` consomme l'`ArrayBuffer`.** Le cloner si on en a besoin ailleurs.
- **Safari iOS** : l'`AudioContext` ne démarre qu'après un geste utilisateur, et les gros
  décodages font tomber l'onglet. Créer le contexte sur le premier clic, et prévoir un message
  explicite plutôt qu'un plantage silencieux.
- **Ne pas faire de FFT sur le main thread.** Même 20 s d'audio gèlent la page.
- **Réutiliser les buffers de FFT.** Une allocation par trame = le GC détruit les perfs.
- **Le spectrogramme se rend en `ImageData` puis un seul `putImageData`.** Un `fillRect` par
  pixel est inutilisable.
- **Formats** : `decodeAudioData` couvre wav/mp3/m4a/flac selon le navigateur, mais pas ogg/opus
  partout. Détecter l'échec et afficher les formats acceptés, ne pas laisser une erreur brute.

---

## 8. Direction visuelle

Le sujet, c'est un **instrument de mesure**, pas une startup SaaS. La page doit ressembler à
un banc de test posé sur un plan de travail : sobre, chiffrée, précise.

**À ne pas produire** (ce sont les défauts de l'IA, pas des choix) : fond crème + display serif
+ accent terracotta ; fond noir + accent vert acide (particulièrement tentant sur de l'audio —
c'est justement pour ça qu'il faut l'éviter) ; empilement de cartes à coins arrondis et ombres
douces.

**Tokens** (`styles/tokens.css`) :

```css
--card:    #DDDCD4;  /* gris carton, fond de page */
--ink:     #16181A;  /* texte */
--rule:    #A8A69C;  /* filets, séparateurs */
--noise:   #3F6795;  /* bleu froid — le bruit, l'avant */
--signal:  #D98E12;  /* ambre de vumètre — la voix, l'après */
--alert:   #A33520;
```

**Typographie** : display `Archivo` (grasse, resserrée, utilisée avec parcimonie),
texte `Public Sans`, chiffres et unités en `IBM Plex Mono` — toutes les mesures (dB, LUFS, Hz)
sont en mono, tabular-nums, sans exception. C'est ce qui donne le ton « appareil de mesure ».

**Élément signature** : la bascule A/B est **chromatique autant que sonore**. En position
« Original », la waveform et le spectrogramme sont en `--noise` ; en « Traité », ils basculent
vers `--signal`, avec la même durée de transition que le crossfade audio. Le froid devient
chaud au moment exact où le bruit disparaît. Toute la hardiesse du design est dépensée ici —
le reste de la page reste silencieux.

**Plancher de qualité**, sans le commenter : responsive jusqu'au mobile, focus clavier visible,
`prefers-reduced-motion` respecté (la bascule reste instantanée, sans transition), canvas
redessinés au `devicePixelRatio`.

**Copie** : nommer les choses par ce que l'utilisateur entend, pas par l'algorithme.
« Souffle de fond » plutôt que « bruit stationnaire large bande ». Les états vides et les
erreurs disent quoi faire, pas pardon.

---

## 9. Jalons

À construire dans cet ordre — chaque jalon doit être démontrable seul.

1. **Squelette** — Vite + TS + React, tokens CSS, sections statiques, contenu réel.
2. **Décodage & waveform** — dropzone, decode, peaks, canvas. Pas encore de traitement.
3. **Worker + repli spectral** — protocole, `spectralGate.ts`, progression. Premier avant/après.
4. **Lecteur A/B** — crossfade, compensation de loudness, transport, tête de lecture.
5. **Analyses** — LUFS, true peak, SNR, plancher de bruit, spectrogramme, panneau de métriques.
6. **RNNoise** — chargement paresseux, wrapper, sélecteur de mode.
7. **Chaîne complète** — passe-haut, de-esser, gate, normalisation.
8. **Export & finitions** — WAV, échantillons de démo, mobile, a11y, message hors-limites.

---

## 10. Commandes

```bash
npm install
npm run dev        # serveur de dev
npm run build      # → dist/
npm run preview    # vérifier le build statique
npm run typecheck
npm run test       # tests des modules audio/ (Vitest, node, sans DOM)
```

**Tests à écrire en priorité** — `audio/` est du TS pur, donc testable directement :
FFT (contre une DFT naïve), encodage WAV (relire l'en-tête), LUFS (contre un signal de
référence à -23 LUFS), et un round-trip du gate spectral sur du bruit blanc pur
(sortie ≈ silence).

---

## 11. Vérification finale

- [ ] Onglet réseau : aucune requête sortante ne transporte d'audio, y compris après traitement.
- [ ] Le site fonctionne servi depuis un simple `file://`-like static host, sans en-têtes spéciaux.
- [ ] La bascule A/B ne produit aucun clic, à volume compensé.
- [ ] Un fichier de 90 s est traité en moins de 5 s sur une machine milieu de gamme.
- [ ] Un fichier non supporté, trop long, ou trop lourd produit un message utile.
- [ ] Lighthouse : perf > 90, a11y = 100.
