# Rendu de la prévisualisation vidéo — QuranCaption

Ce document décrit en détail comment la prévisualisation vidéo est rendue dans
QuranCaption, depuis le chargement de la vidéo/audio jusqu'à l'affichage final
de chaque élément visuel (sous-titres, décorations, effets, etc.).

---

## Table des matières

1. [Architecture générale](#architecture-générale)
2. [La vidéo de fond](#la-vidéo-de-fond)
3. [Le composant VideoOverlay](#le-composant-videooverlay)
4. [Couche 1 — Grille d'alignement](#couche-1--grille-dalignement)
5. [Couche 2 — Image associée au sous-titre](#couche-2--image-associée-au-sous-titre)
6. [Couche 3 — Overlay d'effet](#couche-3--overlay-deffet)
7. [Couche 4 — Fonds (backgrounds) des sous-titres](#couche-4--fonds-backgrounds-des-sous-titres)
8. [Couche 5 — Sous-titre arabe](#couche-5--sous-titre-arabe)
   - [Segments arabes](#segments-arabes)
   - [Crochets décoratifs](#crochets-décoratifs)
   - [Rendu Word-By-Word (WBW)](#rendu-word-by-word-wbw)
   - [Styles inline arabes](#styles-inline-arabes)
9. [Couche 6 — Traductions](#couche-6--traductions)
   - [Segments de traduction](#segments-de-traduction)
   - [Fusion visuelle des traductions](#fusion-visuelle-des-traductions)
10. [Couche 7 — Décorations fixes](#couche-7--décorations-fixes)
11. [Couche 8 — Clips custom](#couche-8--clips-custom)
12. [Système de styles](#système-de-styles)
13. [Ajustement réactif de la taille de police](#ajustement-réactif-de-la-taille-de-police)
14. [Anti-collision](#anti-collision)
15. [Fondu (fade in/out)](#fondu-fade-inout)
16. [Fusion visuelle (Visual Merge)](#fusion-visuelle-visual-merge)
17. [Mode export](#mode-export)

---

## Architecture générale

```
VideoPreview.svelte
├── <video> ou <img>          ← média de fond (vidéo ou image)
└── VideoOverlay.svelte        ← tout le contenu superposé
    ├── Grille d'alignement
    ├── Image associée au sous-titre
    ├── Overlay d'effet (flou, couleur, dégradé)
    ├── Fonds des sous-titres (toujours visibles)
    ├── Sous-titre arabe ──► ArabicSubtitle.svelte
    ├── Traductions ──► TranslationSubtitle.svelte (×N)
    ├── Décorations fixes (SurahName, ReciterName, VerseNumber)
    └── Clips custom (CustomText, CustomImage)
```

Le flux est le suivant :
1. `VideoPreview.svelte` charge le média (vidéo ou image) et l'audio,
   synchronise la lecture avec le curseur de la timeline.
2. `VideoOverlay.svelte` observe le curseur et affiche les éléments
   correspondant au temps courant (sous-titres, traductions, effets).
3. Chaque élément visuel est stylisé via `globalState.getVideoStyle`
   (styles configurables par l'utilisateur).

---

## La vidéo de fond

### Chargement

`VideoPreview.svelte` écoute les changements de position du curseur de la
timeline et détermine quel asset vidéo ou image de fond doit être affiché.
La sélection se fait via :

```typescript
// Récupère l'asset vidéo sous le curseur
currentVideo = globalState.currentProject.content.timeline
    .getCurrentAssetOnTrack(TrackType.Video)

// Récupère l'image de fond
currentImage = globalState.currentProject.content.timeline
    .getBackgroundImage()
```

### Élément HTML

```html
<!-- Si une vidéo est présente -->
<video
    src={convertFileSrc(currentVideo.filePath)}
    muted
    loop={isVideoLooping}
    onended={goNextVideo}
/>

<!-- Si une image est présente (et pas de vidéo) -->
<img src={convertFileSrc(currentImage.filePath)} />
```

La vidéo est toujours **muette** côté HTML — l'audio est géré séparément par
**Howler.js**. Cela permet un contrôle fin de la synchronisation (l'audio est
la source de vérité pour la position du curseur).

### Redimensionnement

La vidéo est redimensionnée pour s'adapter au conteneur tout en préservant
son ratio. La logique est dans `resizeVideoToFitScreen()` :

1. Le ratio de sortie est lu depuis le style `video-dimension`.
2. Si le ratio est 16:9, la preview fait 1920×1080px.
3. Sinon, les dimensions sont ajustées au ratio (ex: 21:9 → 1920×822).
4. Un `transform: scale(...)` est appliqué pour que la preview rentre
   dans le conteneur sans déformation.
5. En mode plein écran, la preview est centrée sur un fond quadrillé sombre.

---

## Le composant VideoOverlay

`VideoOverlay.svelte` est le **chef d'orchestre** du rendu visuel au-dessus
de la vidéo. Il est positionné en `absolute inset-0` sur le conteneur `#preview`.

Il observe en continu :
- La position du curseur de la timeline (`cursorPosition`)
- Le sous-titre courant (`currentSubtitle`)
- Le groupe de fusion visuelle (`currentVisualMergeGroup`)
- Les clips custom (`currentCustomClips`)

Le template est structuré en **8 couches** (du fond au premier plan) :

1. Grille d'alignement (onglet Style uniquement)
2. Image associée au sous-titre
3. Overlay d'effet (flou + couleur/dégradé)
4. Fonds des sous-titres
5. Sous-titre arabe
6. Traductions
7. Décorations fixes
8. Clips custom

---

## Couche 1 — Grille d'alignement

**Quand :** Uniquement dans l'onglet **Style**, si la grille est activée
ou pendant un drag d'élément.

**Rendu :**
```html
<div class="alignment-overlay absolute inset-0 pointer-events-none">
    <div class="alignment-grid"></div>
</div>
```

**CSS :**
```css
.alignment-grid {
    background-image:
        linear-gradient(to right, ... 2px, transparent 2px),
        linear-gradient(to bottom, ... 2px, transparent 2px);
    background-size: 10% 10%;
}
```

La grille affiche des lignes horizontales et verticales tous les 10% de la
largeur/hauteur. La couleur est dérivée de la variable CSS `--text-primary`
avec 28% d'opacité.

---

## Couche 2 — Image associée au sous-titre

**Quand :** Si le sous-titre courant a une image associée
(ex: une page de mushaf), et que le chargement n'a pas échoué.

**Rendu :**
```html
<div style="
    opacity: {subtitleOpacity('arabic')};
    background-image: url('{convertFileSrc(currentSubtitleImagePath)}');
    background-size: contain;
    background-position: center;
    background-repeat: no-repeat;
"></div>
```

L'opacité suit celle du sous-titre arabe. L'image est centrée et contenue
(`contain`) dans le conteneur.

---

## Couche 3 — Overlay d'effet

**Quand :** Si `overlay-enable` est activé dans les styles globaux.

L'overlay se compose de **deux divs** :

1. **Fond coloré ou dégradé** (généré par `getOverlayLayerCss()`)
2. **Flou** (`backdrop-filter: blur(...)`)

### Modes de dégradé

| Mode | Description |
|------|-------------|
| `uniform` | Couleur unie (`background-color`) avec opacité |
| `fade-up` | Dégradé linéaire du haut (opaque) vers le centre (transparent) |
| `fade-down` | Dégradé linéaire du haut (transparent) vers le bas (opaque) |
| `fade-center` | Dégradé avec fondu aux extrémités, opaque au centre |

Les paramètres `fadeIntensity` (différence d'opacité bord/centre) et
`fadeCoverage` (étendue du fondu) sont configurables.

---

## Couche 4 — Fonds (backgrounds) des sous-titres

**Particularité :** Ces fonds sont **toujours visibles**, même quand le
sous-titre n'est pas actif. Ils utilisent un sous-titre de référence
(`backgroundSubtitle`), qui est le sous-titre le plus proche du curseur
(précédent ou suivant).

```html
<div id="subtitles-backgrounds">
    <!-- Fond arabe -->
    <div class="arabic subtitle" style="{getCss('arabic', backgroundClipId)}"></div>

    <!-- Fond par édition de traduction -->
    {#each translationEditions as edition}
        <div class="translation subtitle {edition}" style="..."></div>
    {/each}
</div>
```

Ces divs contiennent uniquement les propriétés de fond (couleur, border,
border-radius, padding, etc.) générées par le système de styles. Elles ne
contiennent pas de texte — le texte est rendu dans les couches 5 et 6.

---

## Couche 5 — Sous-titre arabe

Le rendu du texte arabe est délégué à **`ArabicSubtitle.svelte`**.

### État réactif

Le composant observe :
- `currentSubtitle` (depuis `globalState.getSubtitleTrack`)
- `currentVisualMergeGroup` (fusion visuelle)
- Les styles arabes (depuis `globalState.getVideoStyle.getStylesOfTarget('arabic')`)
- Les données d'alignement WBW (depuis `alignmentMetadata`)

### Modes de rendu

Le texte arabe peut être rendu selon **3 modes** :

#### Mode 0 : Sans WBW, sans crochets

```
"Texte arabe complet"
```

Rendu standard en flux inline. Les segments sont concaténés via
`overlaySegmentsContent`.

#### Mode 1 : Avec crochets décoratifs, sans WBW

```
[L] Texte arabe complet [M]
```

Les crochets sont rendus dans des `<span>` avec la police `QPC2BSML`.
La paire de glyphes dépend du style `decorative-brackets-font-family`
(paires supportées : LM, NO, PQ, RS, TU, VW, XY, Z:, ()).

#### Mode 2 : Word-By-Word (WBW)

Chaque mot arabe est isolé dans un `<span>` individuel, permettant :
- Un surlignage progressif (couleur, fond, soulignement)
- Une apparition progressive (opacity fade)
- Un timing basé sur les données d'alignement audio

```
<span class="arabic-wbw-flow" dir="rtl">
    <span class="arabic-wbw-group">
        <span style="color: rgba(...); background-color: rgba(...);">و</span>
        <span style="...">إذا</span>
        <span style="...">قرئ</span>
        <span>١</span>  <!-- suffixe : numéro de verset -->
    </span>
</span>
```

### Segments arabes

La fonction `getArabicOverlaySegments()` génère les segments selon le type
de clip et la présence de styles inline :

1. **PredefinedSubtitleClip** (ex: Basmala) : 1 segment simple
2. **Sans styles inline** : texte concaténé avec son suffixe
   (le suffixe est fusionné pour éviter des coupures de span dans les
   renderers screenshot comme `modern-screenshot`)
3. **Avec styles inline** (`arabicInlineStyleRuns`) : un segment par
   portion stylée (gras, italique, souligné, couleur)

### Suffixe

Le suffixe (généralement le numéro de verset) est attaché au groupe qui le
porte. Il peut avoir sa propre police (`suffixFontFamily`) et son opacité
est contrôlée par l'état WBW (révélé avec le dernier mot, ou toujours
visible si `alwaysShowVerseNumber` est activé).

### Capture export

En mode export, le conteneur arabe reste en `display: block`. Ce layout est
nécessaire pour éviter que `modern-screenshot` déplace le dernier mot ou le
numéro de verset sur une nouvelle ligne pendant la conversion DOM vers PNG.

Le texte arabe n'est pas enveloppé dans un conteneur flex interne : le flux
inline reste identique au rendu historique. Quand une hauteur fixe est
présente, l'alignement vertical est compensé directement sur le `<p>` par les
helpers `getExportVerticalAlignmentOffset()` et `getExportCaptureLayoutCss()`
dans `helpers/overlayCss.ts`.

---

## Couche 6 — Traductions

Chaque édition de traduction configurée est rendue dans un
**`TranslationSubtitle.svelte`** dédié.

### Visibilité

Seules les éditions présentes dans `visibleTranslationTargets` sont
affichées. En mode fusion `translation` ou `both`, les targets proviennent
du premier clip du groupe de fusion. Sinon, du sous-titre courant.

### Segments de traduction

La fonction `getTranslationOverlaySegments()` distingue deux cas :

1. **VerseTranslation** : supporte les préfixes (ex: numéro de verset),
   les segments avec styles inline, et les suffixes.
2. **Traduction simple** : un seul segment texte.

### Styles inline

Les traductions peuvent avoir des styles inline par mot :
- **bold** → `font-weight: 700`
- **italic** → `font-style: italic`
- **underline** → `text-decoration: underline`
- **color** → `color: rgb(r, g, b)`

### Règle du tiret cadratin

En mode fusion visuelle, si le segment précédent se termine par `—`
(tiret cadratin / em dash), aucun espace n'est ajouté avant le segment
suivant. Cela évite des coupures visuelles dans les traductions
coraniques qui utilisent cette ponctuation.

---

## Couche 7 — Décorations fixes

### SurahName

Affiche le nom de la sourate selon la position configurée dans les styles.

**Source :** `SurahName.svelte` (dans `tabs/styleEditor/`)

### ReciterName

Affiche le nom du récitateur selon la position configurée.

**Source :** `ReciterName.svelte` (dans `tabs/styleEditor/`)

### VerseNumber

Affiche le numéro de verset courant. N'est rendu que si le sous-titre
courant est un `SubtitleClip` (pas un clip prédéfini).

**Props :** `currentSurah` et `currentVerse` du sous-titre.

**Source :** `VerseNumber.svelte` (dans `tabs/styleEditor/`)

---

## Couche 8 — Clips custom

Les clips custom sont des éléments ajoutés par l'utilisateur sur la
timeline. Deux types sont supportés :

### CustomText

Texte personnalisé positionnable. Rendu via `CustomText.svelte`.

**Props :** `customText` = catégorie du `CustomTextClip`.

### CustomImage

Image personnalisée positionnable. Rendu via `CustomImage.svelte`.

**Props :** `customImage` = catégorie du `CustomImageClip`.

Les clips sont récupérés via `globalState.getCustomClipTrack.getCurrentClips()`
et filtrés par type.

---

## Système de styles

Tous les éléments visuels sont stylisés via `globalState.getVideoStyle`.

### Structure

```
VideoStyle
├── global   → styles globaux (overlay, fade-duration, spacing, etc.)
├── arabic   → styles du texte arabe
├── <edition> → styles par édition de traduction (ex: english, french)
```

### Résolution des styles

```typescript
// Récupère l'objet de style pour une cible
const styles = globalState.getVideoStyle.getStylesOfTarget('arabic');

// Lit une valeur effective (avec overrides par clip si applicable)
const opacity = styles.getEffectiveValue('opacity', clipId);

// Génère le CSS complet (toutes les propriétés)
const css = styles.generateCSS(clipId, excludedCategories);

// Génère les classes Tailwind
const tailwind = styles.generateTailwind();
```

### Catégories de styles

Les styles sont regroupés en catégories (ex: `background`, `border`,
`general`, `width`, `max-height`). Certaines catégories peuvent être
exclues du CSS généré — par exemple, le sous-titre arabe de premier plan
exclut `background` et `border` (qui sont déjà dans les fonds).

---

## Ajustement réactif de la taille de police

**Fichier :** `helpers/reactiveFontSize.ts`

Quand un sous-titre a un `max-height` configuré (valeur > 0), la taille
de police est réduite progressivement jusqu'à ce que le texte tienne
dans la hauteur maximale.

### Algorithme

```
1. Applique font-size initial
2. Attend 1 tick (DOM update)
3. Pour chaque élément .subtitle du target :
    a. Si scrollHeight > maxHeightValue + marge :
       - Réduit font-size de 5% (fontSize -= fontSize / 20)
       - Applique la nouvelle taille
       - Attend 1 tick
       - Répète jusqu'à ce que scrollHeight ≤ maxHeightValue + marge
          ou fontSize ≤ 1
```

### Marge pour texte non centré

Si `vertical-text-alignment` ≠ `center`, une marge de 10px est ajoutée
au `maxHeightValue`. Cela compense les dépassements visuels qui peuvent
se produire quand le texte est positionné en bas ou à droite.

### Annulation

Un `AbortController` permet d'annuler l'opération si le sous-titre
change avant la fin du calcul. Quand le curseur bouge rapidement,
seule la dernière exécution aboutit.

---

## Anti-collision

**Fichier :** `helpers/antiCollision.ts`

Si le style `anti-collision` est activé, le système détecte les
chevauchements entre éléments de sous-titres et décale l'élément
le plus bas vers le bas.

### Algorithme

```
1. Récupère tous les éléments .subtitle dans le DOM
2. Pour chaque paire (i, j) avec j > i :
    a. Identifie les targets (arabic, english, french, etc.)
    b. Ignore si même target ou paire déjà traitée
    c. Calcule getBoundingClientRect() pour chaque élément
    d. Si collision détectée (chevauchement des rectangles) :
       - Identifie l'élément le plus bas (top le plus grand)
       - Calcule le chevauchement + spacing
       - Incrémente `reactive-y-position` du target à décaler
       - Attend 1 tick (DOM update)
       - Re-vérifie la collision
       - Répète jusqu'à résolution ou max 10 itérations
```

### Détection de target

`getTargetFromElement()` inspecte les classes CSS de l'élément :
- `arabic` → target `"arabic"`
- `<edition>` → target `"<edition>"` (ex: `"english"`, `"french"`)
- Sinon → `null` (ignoré)

### Limite d'itérations

Maximum 10 itérations par paire pour éviter les boucles infinies
(cas pathologique où deux éléments se repoussent mutuellement).

---

## Fondu (fade in/out)

**Calcul :** `subtitleOpacity(target)` dans `VideoOverlay.svelte`

Chaque sous-titre a une opacité calculée en fonction de :
- Sa position temporelle (startTime, endTime)
- La position du curseur
- La durée de fondu (`fade-duration`, en ms)

### Formule

```
halfFade = fadeDuration / 2

Si timeLeft ≤ halfFade :           // Fondu de sortie
    opacity = (timeLeft / halfFade) × maxOpacity

Si timeSinceStart ≤ halfFade :     // Fondu d'entrée
    opacity = (timeSinceStart / halfFade) × maxOpacity

Sinon :                             // Pleine opacité
    opacity = maxOpacity
```

Le `maxOpacity` est la valeur du style `opacity` pour la cible (arabe
ou édition), typiquement 1.0.

### Cas particuliers

- **Fusion visuelle** : le `activeRange` couvre tout le groupe fusionné
  (`mergedGroup.startTime` à `mergedGroup.endTime`), pas seulement le
  clip courant. Ainsi le fondu s'applique sur toute la durée du groupe.
- **Export** : `fadeDuration = 0` (pas de fondu pour les screenshots).

---

## Fusion visuelle (Visual Merge)

Plusieurs clips de sous-titres peuvent être fusionnés en un seul groupe
visuel. Le mode de fusion détermine ce qui est fusionné :

| Mode | Arabe | Traductions |
|------|-------|-------------|
| `arabic` | Fusionné | Par clip |
| `translation` | Par clip | Fusionné |
| `both` | Fusionné | Fusionné |

### Implémentation

- `currentVisualMergeGroup` : groupe de fusion actif, obtenu via
  `globalState.getSubtitleTrack.getVisualMergeGroupForClipId(subtitle.id)`
- `isTargetMerged(target)` : indique si une cible est en mode fusion
- `getReferenceClipForTarget(target)` : retourne le clip de référence
  pour les styles (premier clip du groupe si fusionné, sous-titre
  courant sinon)

### Chevauchement de mots

Quand des clips sont fusionnés, des mots peuvent se chevaucher
(ex: verset divisé en deux clips qui partagent des mots).

La fonction `getMergedClipsWithoutWordOverlap()` dans
`visualMergeOverlayUtils.ts` :
1. Groupe les clips par verset (`surah:verse`)
2. Pour chaque clip, ajuste `startWordIndex` pour éviter les répétitions
3. Clone les clips avec les textes tronqués si nécessaire
4. Répercute les ajustements sur les traductions et styles inline

---

## Mode export

**Détection :** `window.location.pathname.includes('/exporter')` avec
un paramètre `id` dans l'URL.

En mode export (`isExportCapturePreview = true`) :
- `fadeDuration` = 0 pour éviter tout fondu
- `display: block` est ajouté aux sous-titres pour les renderers
  screenshot qui gèrent mal `display: inline`
- Les segments sans styles inline sont concaténés avec leur suffixe
  pour éviter des coupures de span parasites dans `modern-screenshot`

---

## Résumé des fichiers

| Fichier | Rôle |
|---------|------|
| `VideoPreview.svelte` | Charge la vidéo/image de fond, gère l'audio (Howler), synchronise la lecture |
| `VideoOverlay.svelte` | Orchestre les 8 couches d'affichage au-dessus de la vidéo |
| `ArabicSubtitle.svelte` | Rendu du texte arabe (WBW, crochets, styles inline) |
| `TranslationSubtitle.svelte` | Rendu d'une traduction (segments, styles inline) |
| `helpers/antiCollision.ts` | Résolution des collisions entre sous-titres |
| `helpers/reactiveFontSize.ts` | Ajustement réactif de la taille de police |
| `helpers/overlayCss.ts` | CSS des effets d'overlay et padding de fond |
| `helpers/decorativeBrackets.ts` | Glyphes décoratifs pour les crochets arabes |
| `visualMergeOverlayUtils.ts` | Utilitaires de fusion visuelle (segments, chevauchements) |
| `wordByWordHighlightUtils.ts` | Calcul de l'état et du CSS du highlight WBW |
| `VideoPreviewControlsBar.svelte` | Barre de contrôle (play/pause, vitesse, etc.) |
