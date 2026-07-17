# Polices système et capture d'export

Cette note explique pourquoi les polices système sont réduites avant les captures PNG effectuées
avec `modern-screenshot`, ainsi que les contraintes à préserver lors d'une modification de ce
mécanisme.

## Problème d'origine

Les polices fournies par QuranCaption peuvent être intégrées directement par l'exporteur. Pour une
police installée sur le système, `FontProvider.ts` résout en revanche le fichier réel et ajoute une
règle `@font-face` utilisant une URL Tauri. Cette règle est nécessaire : une simple référence
`font-family` ou `local()` ne garantit pas que la police sera disponible dans le SVG isolé produit
par `modern-screenshot`.

Lors de chaque `domToBlob()`, `modern-screenshot` sérialise les règles `@font-face` utilisées dans
le SVG de capture. Une collection comme `C:\Windows\Fonts\msjh.ttc` pèse environ 20 Mo. Même si son
chargement réseau est mis en cache, la police complète reste injectée en base64, analysée et décodée
pour chaque PNG. Un style utilisant cette police pouvait donc rendre l'étape de capture environ dix
fois plus lente qu'un style visuellement similaire utilisant une petite police.

Le problème était lié à la famille de police sélectionnée, et non à la 4K, à la durée de la vidéo,
au nombre maximal de lignes, à l'anti-collision, au glow, ni au fond des sous-titres.

## Solutions écartées

### Réutiliser uniquement le contexte `modern-screenshot`

Le cache évite une partie des lectures et conversions initiales, mais le SVG de chaque frame
contient toujours la police complète. Le navigateur doit donc encore traiter plusieurs dizaines de
mégaoctets par capture. Cette optimisation seule ne corrige pas le coût principal.

### Ne plus intégrer les polices système

Cela accélère la capture, mais réintroduit les substitutions ou absences de polices dans les PNG.
L'export ne correspond alors plus nécessairement à la preview.

### Utiliser le rendu texte canvas de macOS sur Windows

Le chemin macOS redessine le texte séparément sur un canvas. Il contourne l'intégration des polices,
mais ne reproduit pas encore tous les comportements CSS du chemin Windows, notamment certains
alignements verticaux. Il doit rester réservé à macOS.

## Solution retenue

Le chemin Windows/Linux reste basé sur le DOM et `domToBlob()`. Juste avant la capture :

1. `QPCFontProvider.applySystemFontSubsetsForScreenshot()` parcourt les nœuds texte de l'overlay et
   les regroupe par famille principale calculée avec `getComputedStyle()`.
2. Pour chaque face système enregistrée et réellement utilisée, `SystemFontSubset.ts` charge le
   fichier source puis demande à HarfBuzz de conserver uniquement les caractères visibles et leurs
   dépendances OpenType.
3. La règle `@font-face` est temporairement remplacée par une Data URL contenant cette petite police
   autonome. L'index de face est conservé pour les collections TTC/OTC.
4. `domToBlob()` suit son chemin habituel : le layout et le rendu CSS restent ceux du DOM.
5. Un bloc `finally` restaure toujours les règles originales après la capture.

Les fichiers source et les Data URLs réduites sont mis en cache dans chaque WebView, avec une clé
composée de l'URL, de l'index de face et de l'ensemble des caractères. Une même inscription
statique, comme le nom du récitateur, n'est donc réduite qu'une fois par worker.

Sur le cas ayant révélé le problème, le sous-ensemble de `msjh.ttc` nécessaire à `Yasser Al-Dosari`
passe de 21 402 152 octets à 8 248 octets.

## Périmètre

- Windows et Linux : réduction active sur le chemin `domToBlob()`.
- macOS : inchangé, car le texte utilise déjà le chemin canvas spécifique.
- Polices système résolues par `FontProvider.ts` : concernées.
- Polices QPC, polices embarquées par l'application et polices importées : inchangées.

Si HarfBuzz ne peut pas réduire une face, un warning est écrit et la règle originale reste active.
La capture doit donc rester correcte, mais peut redevenir lente pour cette police.

## Points d'attention

- Toujours restaurer les règles dans un `finally` autour de `domToBlob()`.
- Ne pas remplacer ce mécanisme par le chemin canvas macOS sur les autres plateformes.
- Conserver `fontIndex` : une même collection TTC peut contenir plusieurs faces.
- Le texte généré uniquement par `::before` ou `::after` n'est pas découvert par le parcours des
  nœuds texte. Vérifier ce cas avant d'utiliser une police système dans du contenu CSS généré.
- Chaque worker possède son propre cache et conserve le fichier source en mémoire. Surveiller la RAM
  si le nombre de workers ou de très grosses polices augmente.
- HarfBuzz est volontairement utilisé pour préserver les substitutions et dépendances OpenType ; un
  sous-ensemble naïf de glyphes peut casser le shaping de scripts complexes.

## Vérifications recommandées

1. Comparer visuellement la preview et plusieurs PNG exportés avec une police système lourde.
2. Tester une collection TTC avec plusieurs graisses ou styles.
3. Tester simultanément arabe, traduction, nom du récitateur et nom de sourate.
4. Vérifier une exportation à plusieurs workers et surveiller la mémoire.
5. Confirmer qu'un échec de réduction produit un warning puis une capture correcte avec la police
   complète.

## Fichiers concernés

- `src/lib/services/SystemFontSubset.ts` : chargement WASM, réduction HarfBuzz et caches.
- `src/lib/services/FontProvider.ts` : suivi des règles système, collecte du texte et remplacement
  temporaire des fontes.
- `src/routes/exporter/+page.svelte` : application et restauration autour de `domToBlob()`.
- `package.json` / `package-lock.json` : dépendance `harfbuzzjs`.
