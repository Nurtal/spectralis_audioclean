# Direction visuelle — décisions et refus

Le sujet est un **instrument de mesure**, pas une startup. La page doit
ressembler à un banc de test posé sur un plan de travail : sobre, chiffrée,
précise. Tout ce qui suit découle de cette phrase.

---

## 1. Ce qu'on a refusé

Trois directions ont été écartées d'emblée, parce que ce sont des réflexes de
machine plutôt que des choix :

- **Fond crème, display serif, accent terracotta.** L'esthétique « artisan
  chaleureux ». Elle dit « fait main », alors que l'argument ici est « mesuré ».
- **Fond noir, accent vert acide.** Particulièrement tentant sur un sujet audio
  — c'est exactement pour ça qu'il fallait l'éviter. C'est le fond d'écran par
  défaut de tout logiciel de MAO ; il ne distingue rien.
- **Empilement de cartes à coins arrondis et ombres douces.** Le tableau de
  bord SaaS. Les ombres simulent une profondeur qu'il n'y a pas, les arrondis
  adoucissent une information qui doit rester tranchante.

En pratique, cela se traduit par trois règles tenues partout : **aucun
`border-radius`, aucune `box-shadow`, aucun dégradé** en dehors des rampes de
couleur du spectrogramme, qui encodent une grandeur physique.

Ce qui les remplace : des filets d'un pixel, des angles vifs, des encarts de
papier légèrement plus clair que le fond. Du papier, pas du plastique.

## 2. Palette

| Token | Valeur | Emploi |
|---|---|---|
| `--card` | `#DDDCD4` | fond de page, gris carton |
| `--ink` | `#16181A` | texte |
| `--rule` | `#A8A69C` | filets, séparateurs |
| `--noise` | `#3F6795` | bleu froid — le bruit, l'avant |
| `--signal` | `#D98E12` | ambre de vumètre — la voix, l'après |
| `--alert` | `#A33520` | erreurs |

Surfaces dérivées : `--paper` (encarts), `--paper-deep` (bandeau de fichier),
`--well` (creux).

**Les deux couleurs ne sont pas décoratives, elles sont une légende.** Bleu =
original, ambre = traité. Ce code est appris une seule fois, sur la bascule, et
il est ensuite tenu sans exception : waveform, spectrogramme, colonnes du
tableau de mesures, pastilles de légende. Aucun autre élément de la page n'a le
droit de porter ces deux couleurs pour une autre raison.

### Contraste — les variantes d'encre

L'ambre de vumètre est magnifique en aplat et **illisible en petit corps** :
`#D98E12` sur le carton donne 1.95:1. Le bleu n'est pas beaucoup mieux à 4.26:1.

D'où deux tokens supplémentaires, réservés au **texte** :

- `--noise-ink: #3A5F8A` → 4.79:1
- `--signal-ink: #875603` → 4.54:1

Les aplats et les tracés gardent `--noise` / `--signal`. Une pastille de
légende porte donc la vraie couleur, et le mot à côté sa variante lisible.

Même logique sur la bascule : encre claire sur le bleu (4.26:1, suffisant pour
un texte de cette taille), **encre sombre sur l'ambre** — l'ambre est une
couleur claire, elle porte du texte sombre. Inverser aurait donné 1.95:1.

`--ink-faint` a été assombri de `#7F817F` (2.85:1) à `#5F6162` (4.53:1). Une
légende de onze pixels est du texte, pas de la décoration.

Enfin `--rule-strong: #767469` (3.41:1) pour les bordures qui délimitent un
**contrôle** — sélecteur de mode, zone de dépôt, piste de progression. Les
filets purement séparateurs gardent `--rule`.

## 3. Typographie

- **Archivo** en display, grasse et resserrée, utilisée avec parcimonie : les
  titres de section, les deux mots de la bascule, le nom de la maison. La
  version variable donne un vrai axe de chasse (`font-stretch: 84%`) plutôt
  qu'une condensation simulée.
- **Public Sans** pour le texte courant.
- **IBM Plex Mono** pour **toutes les mesures**, sans exception : dB, LUFS, Hz,
  durées, pourcentages, tailles de fichier, noms de fichier. `tabular-nums`
  partout, pour que les colonnes s'alignent et que rien ne saute quand une
  valeur change en cours de lecture. C'est ce détail, plus que tout autre, qui
  donne le ton « appareil de mesure ».

Les polices sont **auto-hébergées** (`@fontsource`, sous-ensemble latin
uniquement). Un site dont l'argument est « vos données ne partent pas » ne peut
pas appeler `fonts.googleapis.com` à chaque chargement. Ce n'est pas un détail
de performance, c'est une question de cohérence : la vérification de l'onglet
réseau promise dans le hero doit être vraie pour la page entière, pas seulement
pour l'audio.

Le latin seul suffit — il couvre é, è, ê, ç, ù et jusqu'à œ. Déclarer les
sous-ensembles cyrillique, grec et vietnamien sur un site en français, c'est
quatorze fichiers de plus pour zéro caractère affiché : cinq fichiers,
149 Ko, au lieu de quinze.

Les cinq sont **préchargés** par un petit greffon de build
(`preloadFonts` dans `vite.config.ts`). Sans lui, le navigateur ne découvre les
`@font-face` qu'après avoir analysé la feuille de styles, et le titre du hero se
redessine quand Archivo arrive : 0.36 de décalage cumulé au compteur Lighthouse,
soit le plus gros poste de la note de performance. Avec, le décalage est nul.

## 4. L'élément signature

La bascule A/B est **chromatique autant que sonore**. En position « Original »,
la waveform, le spectrogramme et les libellés sont en `--noise` ; en
« Traité », ils basculent vers `--signal`. Le froid devient chaud au moment
exact où le bruit disparaît.

Toute la hardiesse du design est dépensée là. Le reste de la page reste
silencieux — c'est ce qui rend la bascule audible.

**Deux points d'implémentation.**

Le tracé est un canvas : il ne connaît pas les transitions CSS. Le fondu entre
les deux waveforms est donc animé à la main en `requestAnimationFrame`, et les
deux tracés se croisent en opacité comme les deux gains se croisent en audio.
L'inactif ne disparaît pas complètement : il reste en filigrane à 20 %, pour
qu'on voie en permanence ce que le traitement a retiré.

**La durée, elle, s'écarte du cahier des charges.** Celui-ci demande « la même
durée de transition que le crossfade audio », soit 12 ms. À 12 ms, une
transition de couleur ne se voit pas passer : elle est instantanée. Or le même
cahier des charges demande que `prefers-reduced-motion` rende la bascule
« instantanée, sans transition » — ce qui n'aurait aucun sens s'il n'y avait
rien à réduire. On a donc lu l'intention plutôt que la lettre : ce qui compte
est la **simultanéité**, pas l'égalité des durées. Aucun délai n'est introduit,
la couleur part au même instant que le son ; sa durée est de 120 ms, celle de
l'œil, contre 12 ms pour l'oreille. Sous `prefers-reduced-motion`, elle tombe
à zéro.

## 5. La honnêteté comme contrainte de conception

Trois endroits où la mise en forme aurait pu mentir, et ce qu'on a fait :

- **Le traité est normalisé, donc plus fort.** « Plus fort » s'entend comme
  « meilleur ». La case « comparer à volume égal » est donc cochée par défaut,
  et le gain de compensation appliqué est affiché en clair.
- **Le spectrogramme du traité serait plus dense** pour la même raison. Son
  image est donc décalée du même écart de loudness avant d'être dessinée :
  l'œil compare du contenu, pas du gain.
- **Les deux waveforms partagent une échelle verticale.** Normaliser chacune
  ferait paraître le traité « plus gros », ce qui n'est pas une qualité.

## 6. Plancher de qualité

Tenu sans le commenter dans l'interface :

- Responsive jusqu'au mobile. Le tableau de mesures **défile dans son propre
  cadre** plutôt que d'élargir la page : les colonnes de chiffres ne se plient
  pas, mais elles n'ont pas à imposer leur largeur au reste.
- Focus clavier visible partout. La bascule est faite de deux boutons radio,
  pas d'un interrupteur : les flèches fonctionnent sans qu'on les recode, et un
  lecteur d'écran annonce les deux positions au lieu d'un « activé /
  désactivé » qui ne voudrait rien dire ici.
- La waveform et le volet du spectrogramme sont des `role="slider"` pilotables
  aux flèches, avec `aria-valuetext` en clair.
- `prefers-reduced-motion` respecté.
- Canvas redessinés au `devicePixelRatio`. Une page qui prétend mesurer quelque
  chose n'a pas le droit d'être floue.
- Raccourcis clavier : `Espace` pour la lecture, `B` pour la bascule. Ils
  s'effacent dès que le focus est sur un contrôle.

Relevé Lighthouse (build servi statiquement, mobile simulé) : performance 97,
accessibilité 100, bonnes pratiques 100, référencement 100 ; premier rendu à
1.4 s, décalage cumulé nul.

## 7. Copie

Nommer les choses par ce que l'utilisateur **entend**, pas par l'algorithme :
« souffle de fond » plutôt que « bruit stationnaire large bande », « fermer les
blancs » plutôt que « noise gate ». La ligne technique existe quand même, en
petit, à côté — c'est elle qui prouve qu'il y a un métier derrière, mais elle
ne parle pas la première.

Les états vides et les erreurs disent quoi faire, pas pardon. « Format non
reconnu par ce navigateur. Essayez WAV, MP3, M4A ou FLAC. » La limite de 90 s
n'est pas une excuse, c'est un appel : « pour vos fichiers entiers,
écrivez-moi ».

Pas de formulaire de contact. Un formulaire demanderait un serveur pour
recevoir les données ; ce site n'en a pas, et c'est justement l'argument. Le
dire explicitement transforme une limite technique en preuve.

---

## 8. Ce qu'il reste à renseigner

Avant mise en ligne, remplacer :

- l'adresse de contact — `bonjour@spectralis.fr`, dans `sections/Contact.tsx`
  et dans le `<noscript>` de `index.html` ;
- le nom et la ville — « Spectralis », « Nantes », dans `App.tsx` et
  `sections/Hero.tsx` ;
- les trois extraits de `public/samples/` par de vraies prises françaises
  (cf. `docs/dsp-notes.md` §5).
