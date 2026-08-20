# Notes de traitement du signal

Ce que fait chaque étage, pourquoi ces constantes-là, et comment on a vérifié.
Ordre de lecture conseillé : §1 (mesures) avant §3 (traitement), parce que
presque tous les seuils du traitement sont dérivés d'une mesure.

---

## 1. Mesures

### 1.1 Loudness — `analysis/metrics.ts`

Implémentation de la **BS.1770-4** : pondération K, blocs de 400 ms à 75 % de
recouvrement, double portillonnage (absolu à −70 LUFS, relatif à −10 LU).
Canal unique, poids `G = 1.0`.

Les coefficients de la pondération K ne sont pas recopiés de la table 48 kHz de
la recommandation : ils sont **redessinés analytiquement** à partir des
constantes de conception (`f0 = 1681.974`, `G = 3.9998`, `Q = 0.70718` pour le
plateau ; `f0 = 38.135`, `Q = 0.50033` pour le passe-haut RLB). Le mesureur
donne donc la même lecture à 44.1 kHz qu'à 48 kHz, ce que vérifie un test.

Réponse obtenue, pour mémoire :

| Fréquence | Gain |
|---|---|
| 20 Hz | −13.3 dB |
| 100 Hz | −1.1 dB |
| 500 Hz | 0.0 dB |
| 1 kHz | +0.7 dB |
| 5 kHz et au-delà | +4.0 dB |

Le +0.7 dB à 1 kHz surprend souvent : le plateau est calé sur 1682 Hz, à 1 kHz
on n'en a monté qu'une partie. Ce n'est pas un défaut d'implémentation.

**Vérification.** Confronté à `ffmpeg -af ebur128` sur trois signaux (sinus
1 kHz à deux niveaux, bruit blanc) :

| Signal | ffmpeg | nous | écart |
|---|---|---|---|
| sinus 1 kHz | −41.1 LUFS | −41.06 | 0.04 |
| sinus 1 kHz fort | −21.1 LUFS | −21.07 | 0.03 |
| bruit blanc | −12.1 LUFS | −12.09 | 0.01 |

### 1.2 Crête vraie

Sur-échantillonnage ×4 par banc polyphasé, **24 coefficients par phase**.

La BS.1770-4 en spécifie 12. C'est suffisant pour du contenu tonal, et
insuffisant pour du large bande : mesuré contre `ffmpeg`, un filtre à 12
coefficients sous-estime la crête d'un bruit blanc de **1.1 dB**. À 24
coefficients l'écart tombe à 0.06 dB. La fenêtre de Hann est centrée sur le pic
du sinus cardinal, qui se décale avec la phase — la centrer sur la grille
d'indices déforme les phases 1 à 3 et coûte à elle seule 0.4 dB.

On ne reconstruit pas les quatre millions de points d'un fichier de 90 s :
seulement autour des **maxima locaux** de |x| situés à moins de 2 dB de la
crête échantillon. Une crête inter-échantillon ne surgit pas au milieu d'un
passage faible. Coût mesuré sur 90 s : ~40 ms sur de la voix, ~340 ms sur du
bruit blanc (le pire cas, un maximum local tous les trois échantillons), pour
0.06 dB d'écart avec la recherche exhaustive.

Vérification contre `ffmpeg -af ebur128=peak=true` : −4.99 / −18.06 / −38.05
contre −4.9 / −18.1 / −38.1.

### 1.3 Plancher de bruit — `analysis/noiseFloor.ts`

**Percentile 10** des valeurs efficaces sur trames de 20 ms. Une prise de voix
est intermittente : les 10 % les plus faibles, ce sont les blancs, donc le
bruit. Plus robuste qu'un minimum — un seul creux fausserait tout — et ne
demande aucune détection préalable.

### 1.4 Détection d'activité vocale — `analysis/vad.ts`

Énergie sur trames de 20 ms, pas de 10 ms, seuil **relatif au plancher estimé**
(+9 dB), hystérésis de 4 dB, traîne de 180 ms, segments minimaux de 90 ms.
Le seuil étant relatif, le résultat ne dépend pas du niveau du fichier.

Garde-fou : si l'écart entre le percentile 10 et le percentile 95 est plus
petit que le seuil d'ouverture, on place le seuil à mi-chemin. Sans ça, un
fichier sans dynamique serait classé « tout parole » ou « tout silence ».

### 1.5 Spectrogramme — `analysis/spectrogram.ts`

STFT Hann 2048 / hop 512, axe des fréquences **logarithmique** de 40 Hz à
16 kHz sur 192 lignes, plage dynamique −95 à −5 dB quantifiée sur 8 bits.

Deux plafonds : le nombre de colonnes est limité à 1400 (au-delà on transfère
des mégaoctets pour des pixels que personne ne verra), et au-dessus de ~4 kHz
une ligne d'image couvre plusieurs bins — on y prend le **maximum** de
l'intervalle, pas une interpolation, sinon les harmoniques disparaissent.

---

## 2. Transformée de Fourier — `analysis/fft.ts`

Deux implémentations, la seconde bâtie sur la première :

- `FFT` — radix-2 Cooley-Tukey complexe, en place, tables de rotation et
  permutation binaire précalculées à la construction. **Aucune allocation par
  appel** : une allocation par trame et le ramasse-miettes mange tout le budget
  sur un fichier de 90 s.
- `RealFFT` — entrée réelle. On replie les N échantillons en N/2 complexes
  (pairs en partie réelle, impairs en partie imaginaire), une FFT de taille
  N/2, puis un dépliage par symétrie hermitienne.

Le passage du gate spectral et du spectrogramme à `RealFFT` a fait passer le
débruitage spectral de 1985 ms à 1337 ms sur 90 s, soit **−33 %**.

`RealFFT` est testée bin par bin contre le chemin complexe, aux trois tailles
16 / 256 / 2048, plus les cas particuliers du continu et de Nyquist.

---

## 3. Traitement

### 3.1 Passe-haut — `stages/highpass.ts`

Butterworth ordre 4 à 80 Hz : deux biquads en cascade aux facteurs de qualité
0.5412 et 1.3066. Deux biquads **identiques** donneraient une bosse juste
au-dessus de la coupure ; ces valeurs-là donnent une réponse plate.

Sous 80 Hz une voix parlée n'a rien à dire — même une voix grave d'homme pose
son fondamental vers 85–100 Hz. On y trouve le rumble de bureau, le camion, le
choc de table, le vent dans un micro-cravate.

### 3.2 Gate spectral — `stages/spectralGate.ts`

Chemin de repli, et mode « doux » en production.

1. STFT Hann 2048 / hop 512.
2. Profil de bruit : percentile 10 par bin, **sur les trames non-parole**
   marquées par le VAD (retour sur la totalité du fichier s'il y en a moins de
   huit).
3. Correction de biais **×2.73** — voir ci-dessous.
4. Masque `gain = max(plancher, (mag − β·bruit) / mag)`.
5. Lissage du masque sur 3 trames et 3 bins.
6. ISTFT, overlap-add avec fenêtre de synthèse et normalisation accumulée.

**La correction de biais.** Le percentile 10 est robuste — il ne peut pas être
contaminé par de la voix — mais il ne mesure pas le bruit, il mesure son creux.
Pour un bruit stationnaire, la magnitude d'un bin suit une loi de Rayleigh :
son percentile 10 vaut 0.459·σ quand sa moyenne vaut 1.253·σ. Le rapport est
constant, donc corrigeable. Sans cette correction, β perd le sens qu'il a dans
la littérature et il faudrait le monter à 4 pour obtenir l'effet qu'on obtient
à 1.5 ; mesuré, un bruit blanc pur n'était atténué que de 8 dB au lieu de 18.

β et le plancher suivent le dosage : `β = 1.5·(0.6 + 0.8·dosage)`, plancher de
−6 dB à −18 dB. On ne descend pas sous −18 dB : c'est ce plancher qui évite le
« musical noise », ces petites cloches aléatoires que produit un masque nu.

Le lissage temporel est **centré** sur trois trames, donc la resynthèse est
retardée d'une trame. C'est le seul endroit du fichier où l'ordre des
opérations est subtil.

Le profil est estimé sur des trames sous-échantillonnées (1500 au maximum) :
un percentile n'a pas besoin de toutes les voir, et stocker 8000 trames ×
1025 bins coûterait 35 Mo pour rien.

### 3.3 RNNoise — `rnnoise/`

Portage `@jitsi/rnnoise-wasm` 0.2.1 (Apache-2.0, RNNoise lui-même sous BSD).
Glue Emscripten en module ES + binaire de 112 Ko, copiés dans
`public/wasm/rnnoise/` par `scripts/copy-rnnoise.mjs` et chargés par import
dynamique **à la première utilisation** — jamais au premier rendu.

Deux pièges, tous les deux payés d'un silence ou d'une saturation totale :

- RNNoise travaille à l'échelle **int16**, pas dans [−1, 1]. Multiplier par
  32768 en entrée, diviser en sortie.
- Il est figé à **48 kHz mono, trames de 480 échantillons**. Le pipeline
  rééchantillonne en amont ; la dernière trame partielle est complétée de
  zéros puis tronquée en sortie.

Troisième piège, plus discret : `HEAPF32` peut être **remplacé** si le tas
WASM grandit. On le relit après chaque appel plutôt que de le capturer une
fois.

L'URL du module vient du thread principal : lui seul connaît `document.baseURI`,
et donc le sous-chemin réel du déploiement. Le worker, lui, vit dans `assets/`.

Tout échec — pas de réseau, WASM refusé par une politique de sécurité,
fréquence inattendue — **retombe sur le gate spectral** et le dit dans l'UI,
plutôt que d'afficher une erreur pour un résultat qu'on sait produire
autrement.

### 3.4 De-esser — `stages/deesser.ts`

Bande 5–9 kHz isolée par un biquad passe-bande, détecteur en valeur efficace,
compression 4:1, réduction plafonnée à −12 dB. La sortie est
`x − (1 − g)·bande` : **soustraction dynamique**, pas remélange. Compresser la
bande puis la réinjecter déphaserait le reste du spectre ; ici le signal n'est
touché que quand la bande dépasse, et seulement de ce qu'elle dépasse.

Le seuil est relatif au niveau **médian** de la bande, pas à sa moyenne : une
sifflante est brève, elle tire la moyenne vers le haut et finirait par fixer son
propre seuil. Garde-fou : le seuil ne descend jamais sous le niveau efficace
global de la bande, pour ne pas raboter une prise simplement sourde.

### 3.5 Gate — `stages/gate.ts`

Seuil dérivé du plancher mesuré (+6 dB à l'ouverture, −3 dB d'hystérésis),
atténuation **plafonnée à −18 dB**. Un gate qui ferme complètement s'entend
comme un trou ; ce qui reste sonne comme une pièce calme, pas comme une coupure
de ligne.

Deux détails qui ont coûté du débogage :

- Le détecteur est une **valeur efficace sur fenêtre glissante centrée de
  10 ms**, pas un suiveur de crête. Le seuil vient d'un plancher mesuré en RMS ;
  comparer une crête à un RMS se trompe de 5 dB sur du bruit large bande, et le
  gate reste alors ouvert en permanence. La fenêtre étant centrée, le détecteur
  voit l'attaque du mot arriver — gratuit hors ligne, et ça évite de raboter la
  consonne initiale.
- Les durées d'attaque et de retour sont des **temps de trajet**, pas des
  constantes de temps (`exp(−4/(t·fs))`). « Retour 160 ms » doit vouloir dire
  « fermé au bout de 160 ms », pas « au bout de 800 ».

### 3.6 Normalisation — `stages/loudness.ts`

Cible −16 LUFS (plateformes de podcast), plafond −1 dBTP (marge pour
l'encodage lossy en aval, où la crête reconstruite dépasse la crête
échantillon). Gain global borné à ±24 dB : on ne remonte pas un fichier quasi
muet de 40 dB.

Le limiteur est **à anticipation, en deux passes** : passe arrière, le gain
commence à descendre 3 ms avant la crête ; passe avant, il remonte en 120 ms.
Une réduction appliquée au moment exact de la crête s'entend comme une
distorsion ; anticipée, elle ne s'entend pas.

Le limiteur travaille sur la crête échantillon, mais le plafond porte sur la
crête vraie. On part avec 0.4 dB de marge, **puis on resserre tant que la
mesure inter-échantillon déborde** (trois passes au maximum). Sur un signal à
contenu très aigu — une impulsion rectangulaire, par exemple — l'écart entre
les deux atteint 1 dB, et une marge fixe ne suffit pas.

Le limiteur mange un peu de loudness ; on corrige ensuite, sans jamais
repasser au-dessus du plafond.

---

## 4. Budget de temps

Mesuré sur un fichier de 90 s (extrait de démo répété), mode doux, Node 22 :

| Étape | Temps |
|---|---|
| VAD | 13 ms |
| Waveform | 17 ms |
| Spectrogramme | 108 ms |
| LUFS | 68 ms |
| Crête vraie | 42 ms |
| Passe-haut | 39 ms |
| **Gate spectral** | **1337 ms** |
| De-esser | 309 ms |
| Gate | 71 ms |
| Normalisation | 350 ms |
| **Total (deux analyses comprises)** | **~2.5 s** |

En mode neural, le débruitage est très inférieur au temps réel et le total
descend nettement sous la seconde et demie. Le cahier des charges demande
moins de 5 s pour 90 s : la marge est là, y compris sur une machine deux fois
plus lente.

---

## 4 bis. Le contexte de lecture ne force rien

Le pipeline travaille à 48 kHz parce que RNNoise l'exige. Il serait tentant
d'imposer la même fréquence à l'`AudioContext` de lecture pour éviter un
rééchantillonnage — c'est ce que faisait la première version, et c'est une
faute.

Sur une sortie cadencée à 44.1 kHz, `new AudioContext({ sampleRate: 48000 })`
fait ouvrir à Chrome un flux que la couche audio du système doit reconvertir.
Sous PulseAudio ou PipeWire, ça donne au mieux de la latence, au pire du
**silence complet**.

Le symptôme est particulièrement trompeur, parce que rien ne le signale depuis
la page : le contexte se déclare `running`, son horloge avance en temps réel, et
un `AnalyserNode` branché sur le graphe mesure du signal (RMS 0.13 mesuré). La
panne est en aval de tout ce que JavaScript peut observer. Le seul indice est
`ctx.sampleRate !== new AudioContext().sampleRate`.

On laisse donc `AudioBufferSourceNode` rééchantillonner. Vérifié en rendu hors
ligne, un tampon 48 kHz joué dans un contexte 44.1 kHz conserve sa durée à
l'échantillon près, sa fréquence et son amplitude. Bénéfice secondaire : la
latence de base retombe de 21 à 12 ms, ce qui rend la bascule A/B plus franche.

**Règle générale** : le pipeline impose sa fréquence, la lecture prend celle de
la machine. Les deux ne se négocient pas au même endroit.

---

## 5. Écarts assumés par rapport au cahier des charges

- **`analysis/stft.ts` n'existe pas.** Le gate spectral et le spectrogramme
  portent chacun leur boucle de trames : l'un garde les spectres complexes pour
  resynthétiser, l'autre ne veut que des magnitudes et les replie sur un axe
  logarithmique. Une abstraction commune aurait eu deux modes et zéro autre
  usager. Ce qui était réellement partageable — le percentile par bin — vit
  dans `noiseFloor.ts`.
- **`lib/canvas.ts` a été ajouté** : dimensionnement au `devicePixelRatio`,
  lecture des variables CSS, mélange de couleurs, animation. Partagé par la
  waveform et le spectrogramme, il n'avait pas sa place dans l'un des deux.
- **Le protocole worker porte un `id`.** Quand l'utilisateur change de réglage
  pendant un traitement, le résultat de l'ancien arrive quand même ; sans
  identifiant il écraserait le nouveau.
- **24 coefficients de crête vraie au lieu de 12** — mesuré, argumenté en §1.2.
- **Les extraits de `public/samples/` sont des bouchons synthétiques**
  (voix `flite`, bruits construits au filtre, cf. `scripts/make-samples.sh`).
  Ils sont reproductibles et calibrés, mais la voix est anglophone et
  artificielle : à remplacer par de vraies prises françaises avant mise en
  ligne.

---

## 6. Ce qui est testé

`npm run test` — 51 assertions, `audio/` uniquement, sans DOM.

- **FFT** contre une DFT naïve ; aller-retour ; placement d'une sinusoïde.
- **RealFFT** contre le chemin complexe, bin par bin, trois tailles ; continu
  et Nyquist.
- **WAV** : en-tête relu champ par champ, tailles cohérentes, bornage des
  valeurs hors plage.
- **LUFS** contre un signal de référence calculé pour lire exactement −23.0 et
  −16.0 LUFS ; linéarité en gain ; indépendance à la fréquence
  d'échantillonnage ; insensibilité aux blancs ; réponse de la pondération K.
- **Crête vraie** : jamais sous la crête échantillon, détection du dépassement
  inter-échantillon d'une sinusoïde mal alignée.
- **Gate spectral** : bruit blanc pur réduit de plus de 14 dB ; salves de
  porteuse conservées à 1.5 dB près pendant que les blancs perdent 10 dB ;
  monotonie par rapport au dosage.
- **Étages** : réponse du passe-haut aux fréquences clés, gate qui ferme sans
  couper l'attaque du mot suivant, de-esser qui ne touche pas une voix sans
  sifflante, normalisation qui atteint la cible et respecte le plafond.
- **Pipeline** : progression monotone jusqu'à 1, ordre des étapes, cible
  atteinte, plancher qui baisse plus que le signal ne monte, repli sur le mode
  doux en l'absence du module neural, et identité stricte quand toutes les
  étapes sont désactivées.
