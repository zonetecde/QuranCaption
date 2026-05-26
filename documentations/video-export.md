# Exportation vidéo

Cette documentation décrit le pipeline d'export vidéo actuel. Elle est volontairement
opérationnelle: l'objectif est qu'une future session puisse comprendre pourquoi les captures, les
chunks et les transitions sont faits de cette façon sans devoir reconstituer tout l'historique.

## Fichiers principaux

- `src/routes/exporter/+page.svelte`: fenêtre d'export, calcul des timings frontend, capture des
  PNG, duplication des PNG, appel Tauri `export_video`.
- `src/lib/services/ExportCaptureTiming.ts`: logique pure qui décide quels instants doivent être
  matérialisés en captures.
- `src-tauri/src/exporter/commands.rs`: scan des PNG, chunking temporel, rendu FFmpeg, concat/mux
  final.
- `src/lib/components/projectEditor/videoPreview/wordByWordHighlightUtils.ts`: logique de highlight
  word-by-word. Les bugs de timing WBW visibles dans les captures viennent souvent de là.

## Vue générale

L'export ne rend pas directement la timeline complète depuis le DOM. Il fonctionne en deux grandes
phases:

1. Le frontend capture une liste limitée de PNG représentant les états visuels importants de
   l'overlay.
2. Rust/FFmpeg transforme ces PNG en vidéo en recréant les durées et les fondus entre captures.

Les PNG ne représentent donc pas chaque frame vidéo. Ils représentent les points d'état entre
lesquels FFmpeg interpole avec des fondus.

## Pourquoi on capture seulement certains timings

Capturer chaque frame depuis le DOM serait trop lent et trop lourd. À 30 FPS, une vidéo de 6 minutes
demanderait plus de 10 000 captures DOM. À la place, on capture uniquement les instants où l'overlay
peut changer:

- début de l'export;
- fin de l'export;
- début/fin utile des sous-titres;
- fin de fade-in et début de fade-out;
- changements word-by-word;
- blanks nécessaires entre sous-titres;
- bornes d'overlays temporisés comme custom text, nom de sourate, nom du récitateur;
- certains timings exacts de merge visuel.

La fonction centrale est `calculateCaptureTimingsForRange()` dans `ExportCaptureTiming.ts`.

## Timings frontend: `uniqueSorted`

`calculateCaptureTimingsForRange()` retourne notamment:

- `uniqueSorted`: timings absolus en millisecondes à matérialiser.
- `duplicableTimings`: map `target -> source` quand deux timings peuvent réutiliser la même image.
- `imgWithNothingShown`: première blank source pour un état visuel donné.
- `blankImgs`: blanks supplémentaires duplicables depuis une blank source.
- `exactCaptureTimings`: timings qui doivent être capturés exactement, sans `+1ms`.

La majorité des captures utilisent `timing + 1` au moment de déplacer le curseur:

```ts
const captureTiming = timings.exactCaptureTimings.has(timing) ? timing : timing + 1;
```

La raison: beaucoup de bornes sont des fins de clip. Si on capture exactement à la fin, le renderer
peut tomber dans l'état précédent ou dans un trou entre deux clips selon les comparaisons
inclusives. Le `+1ms` force l'état juste après la frontière.

Exception: `exactCaptureTimings` est utilisé pour les transitions internes d'un merge visuel. Dans
ce cas, avancer de `+1ms` peut faire disparaître un état encore nécessaire dans le groupe merge.

## Cas word-by-word et merge visuel

Pour le WBW, un sous-titre mergé visuellement peut contenir plusieurs clips logiques. Le texte peut
être affiché comme un seul groupe, mais les mots gardent leurs propres timestamps.

`getExportWordByWordHighlightTimings()` agrège donc les timestamps WBW de tous les clips du même
groupe de merge arabe. Sans ça, une capture située à l'intérieur d'un groupe merge peut perdre les
highlights persistants ou capturer un état "aucun mot highlight".

Invariant important: une frame à l'intérieur d'un groupe merge n'est pas une vraie frontière de
groupe, même si elle correspond à la fin d'un clip logique. Les vraies frontières sont au début ou à
la fin du groupe merge complet.

## Blanks

Une blank est une capture sans sous-titre affiché. Elle peut quand même contenir des overlays:

- nom de sourate;
- nom du récitateur;
- custom text;
- autres overlays temporisés.

Deux blanks ne sont duplicables que si leur état visuel est identique. La clé de comparaison est
construite avec la sourate et les overlays temporisés visibles:

```text
surah:<numero>|overlays:<signature>
```

Les fichiers temporaires `blank_*.png` servent de sources de duplication. Ils sont supprimés avant
l'appel Rust, parce que FFmpeg ne doit voir que les PNG numérotés par timestamp.

## Nom des PNG et timeline FFmpeg

Les PNG finaux sont nommés avec un nombre, par exemple:

```text
0.png
190.png
340.png
590.png
```

Ce nombre est le timestamp utilisé par Rust/FFmpeg, pas forcement le timing brut de capture DOM.

Dans `+page.svelte`, le nom est calculé avec:

```ts
let base = -fadeDuration;
const imageIndex = Math.max(Math.round(timing - exportStart + base), 0);
base += fadeDuration;
```

Pourquoi ce décalage existe: chaque transition FFmpeg en `xfade` fait se chevaucher deux segments
pendant `fadeDuration`. Si on gardait les timestamps bruts sans compensation, chaque fade ajouterait
ou retirerait du temps et l'audio finirait décalé. Les noms de fichiers représentent donc une
timeline déjà compensée pour les fades.

Rust scanne ensuite le dossier, trie les PNG par stem numérique, et construit:

- `image_paths`: chemins des PNG;
- `timestamps_ms`: stems numériques des PNG;
- `blank_timestamps`: subset des stems qui correspondent à des blanks.

La première image doit être `0.png`.

## Rendu FFmpeg d'un chunk

La fonction principale de rendu d'un chunk est `render_ffmpeg_filter_complex_single()`.

Elle crée d'abord un fichier `images-xxxxxxxx.ffconcat` avec les PNG et leurs durées. FFmpeg lit
ensuite ce concat comme une entrée vidéo unique.

Pour chaque image:

1. FFmpeg crée un flux de base à partir du concat demuxer.
2. Le flux est splitté en autant de segments qu'il y a d'images dans le chunk.
3. Chaque segment est trimé sur sa fenêtre temporelle.
4. Les segments RGBA sont prémultipliés.
5. Les segments sont chaînés avec `xfade=transition=fade`.
6. Le résultat est overlay sur le fond vidéo ou sur un fond noir.
7. Si l'export est transparent, l'overlay est rendu avec alpha.

Le `xfade` est donc appliqué entre les captures à l'intérieur d'un chunk. C'est la seule place où
les transitions normales entre images doivent être créées.

## Background vidéo et audio

Les vidéos de fond sont prétraitées avant le rendu des chunks quand elles existent. Les chunks
réutilisent ensuite ce fond prétraité via un trim local.

L'audio n'est pas injecté dans les chunks internes. Les chunks sont rendus sans audio, puis l'audio
est ajouté à la fin pendant le mux final. Cela évite de multiplier les traitements audio et limite
les risques de décalage.

## Rôle du chunk size

Le chunk size est maintenant une durée cible côté Rust. Le frontend capture toujours une seule liste
de PNG; Rust découpe ensuite cette timeline compensée en chunks temporels.

Le réglage stocké reste `batchSizeMode` / `batchSize` pour compatibilité avec les settings
existants, mais son sens est désormais:

- `auto`: Rust choisit la durée du prochain chunk selon la RAM observée;
- `fixed`: la valeur 1-200 est convertie en durée, de 5 secondes à 10 minutes.

Important: ce n'est pas un nombre de frames vidéo, ce n'est pas un nombre de traitements parallèles,
et ce n'est plus un nombre de captures PNG.

Pourquoi chunker: un gros filtergraph avec des centaines de captures crée beaucoup de splits, trims,
xfades et labels FFmpeg. Ça peut consommer énormément de RAM, ralentir ou planter. Les chunks
limitent la durée et donc la taille pratique des filtergraphs, tout en gardant l'ancien rendu rapide
par graph complet.

## Auto chunk size

En mode `auto`, Rust démarre avec un chunk cible de 30 secondes. Chaque commande FFmpeg de rendu est
surveillée et sert à adapter le chunk suivant:

- si la RAM système atteint 90%, FFmpeg est stoppé et le même chunk est retenté avec une durée
  réduite d'environ un tiers;
- la durée minimale est 5 secondes;
- après un chunk réussi avec un pic RAM inférieur à 72%, le chunk suivant augmente jusqu'à 10
  minutes;
- après un chunk réussi avec un pic RAM supérieur ou égal à 86%, le chunk suivant diminue d'environ
  un tiers;
- si un chunk de 5 secondes dépasse encore la limite, l'export échoue avec une erreur explicite.

Ce système remplace le batch size 3.5.0: l'application n'essaie plus de limiter directement le
nombre de captures par graph, elle adapte la durée des chunks à la mémoire disponible.

## Frontière entre chunks

Le merge final des chunks ne doit pas créer de transition visuelle. Il assemble des vidéos déjà
rendues. Les transitions doivent donc être terminées à l'intérieur des chunks eux-mêmes.

Règle actuelle:

```text
un chunk non final peut finir à l'index i et le chunk suivant reprend à ce même index i.
```

Cette frontière est choisie par `choose_shared_chunk_end_idx()`:

- on coupe autour de la durée cible du chunk;
- on garde la dernière image du chunk précédent comme première image du chunk suivant;
- la capture partagée sert uniquement de référence visuelle pour reconstruire la transition
  suivante.

Exemple:

```text
chunk 0: image[0] ... image[11]
chunk 1: image[11] ... image[22]
chunk 2: image[22] ... image[33]
```

La coupure peut être faite n'importe où tant que cette capture commune existe.

## Pourquoi utiliser une frame partagée

Le chunk suivant a besoin de l'image précédente pour construire son premier `xfade`. Sans image
commune, il commencerait directement sur l'image suivante et la transition visible entre les deux
captures serait perdue.

La frame partagée résout ce problème sans ajouter de fondu au merge final:

- le chunk précédent rend jusqu'à la capture de frontière;
- le chunk suivant reprend depuis cette même capture;
- le premier `xfade` du chunk suivant va de la capture partagée vers la capture suivante;
- la durée de la capture partagée n'est pas comptée deux fois dans la vidéo finale.

## Chevauchement entre chunks

Après chaque chunk non final:

```rust
batch_start_idx = batch_end_idx - 1;
```

Les noms de variables Rust gardent encore parfois `batch` pour limiter le diff, mais le comportement
est bien un chunking temporel. Le chunk suivant reprend donc sur la dernière capture du chunk
précédent. C'est indispensable:

- ça donne au chunk suivant une première image de référence;
- ça permet de reconstruire sa première transition interne;
- ça évite d'avoir besoin d'un `xfade` entre fichiers chunks pendant le merge.

Le code conserve aussi `batch_start_completed_fade_ms`. Il sert à ajuster les timestamps locaux du
chunk suivant pour tenir compte du fade déjà consommé à la frontière. Cette compensation est ce qui
empêche la frame commune d'ajouter du temps en double.

## Durées des chunks

Les durées ne sont pas déduites uniquement du nombre d'images. Elles sont calculées avec la timeline
compensée:

- `capture_timeline_ms(timestamp, image_index, fade_duration)` retire les fades déjà complètes;
- `cumulative_frames_for_time_ms()` convertit le temps en frame count selon le FPS;
- `frames_to_seconds()` force une durée exacte en secondes;
- `duration_s_override` force FFmpeg à rendre exactement la durée attendue du chunk.

But: la somme des chunks doit rester égale à la durée finale, sans ajouter de frames invisibles qui
décaleraient progressivement l'audio.

## Merge final des chunks

Le merge final se fait dans `concat_internal_batch_videos()` pour éviter un renommage large, mais il
assemble maintenant des chunks temporels.

Cas rapide, le plus important:

- si pas de fade vidéo global et pas d'export transparent, les chunks sont concaténés avec le concat
  demuxer FFmpeg et `-c copy`;
- si l'audio existe, on concatène d'abord la vidéo temporaire en stream-copy, puis on mux l'audio
  avec `mux_video_copy_with_audio()`;
- le stream-copy évite de réencoder et ne charge pas tous les chunks en RAM.

Cas fallback:

- si un fade vidéo global est demandé, ou si l'export transparent impose un traitement vidéo, FFmpeg
  utilise un filtergraph de concat simple;
- ce fallback ne doit pas réintroduire de `xfade` entre chunks.

Invariant important: les transitions entre captures appartiennent aux chunks. Le merge final ne doit
pas inventer de transition entre fichiers chunks.

## Pourquoi il ne faut pas faire de `xfade` au merge

Un `xfade` entre chunks a plusieurs problèmes:

- il force FFmpeg à charger beaucoup d'entrées chunks dans un gros filtergraph;
- avec beaucoup de chunks, la RAM peut exploser;
- la ligne de commande peut devenir trop longue si on passe tous les fichiers en inputs directs;
- ajouter du padding ou des frames au merge peut créer un décalage audio/vidéo cumulatif;
- le fade est moins précis car il agit sur des vidéos déjà rendues, pas sur les captures source.

La bonne architecture actuelle est:

```text
captures PNG -> fades internes dans chaque chunk -> concat/mux final sans fade inter-chunk
```

## Progression export

Le frontend émet la progression pendant la capture des frames. Rust émet ensuite la progression
FFmpeg via `run_ffmpeg_command()` et `-progress pipe:2`.

Les étapes importantes visibles côté UI sont:

- capture des frames;
- creating video, pendant le rendu FFmpeg des chunks;
- merging files, pendant le concat/mux final.

L'export monitor regroupe toujours le preprocessing background dans `Creating Video`, mais affiche à
nouveau `Merging Files` pour le concat/mux final afin d'éviter une deuxième progression
`Creating Video` de 0 à 100%.

Pendant le chunking, `progress_base_s`, `progress_total_s` et `local_duration_s` permettent de
rapporter la progression locale d'un chunk dans la timeline globale.

## Logs utiles

Logs frontend utiles:

```text
Normal export - Timings détectés: [...]
Waiting for frame at <timing>ms...
Screenshot saved to: ...
Normal export: Screenshot taken at timing <timing> -> image <imageIndex>
```

Logs Rust utiles:

```text
[scan] <n> image(s) trouvée(s)
[timeline] Premiers timestamps: [...]
[perf] chunk_size=<n>
[perf] chunk_duration_ms=<n>
[chunking] <n> image(s), mode <mode>, durée initiale <ms>, rendu interne en chunks
[chunking] <n> timing(s) blank disponibles pour le rendu
[chunking] chunk <idx>: images <start>..<end> ... encoded_duration=<s>
[memory][auto-chunk] chunk <idx> peak <percent>%, next duration <old>ms -> <new>ms
```

Pour diagnostiquer une coupure visible entre deux chunks, regarder:

- `images start..end` du chunk précédent;
- `images start..end` du chunk suivant;
- si le `end` du précédent est bien le `start` du suivant;
- si la transition attendue se trouve dans le chunk qui commence sur cette image partagée;
- si la durée forcée du chunk laisse assez de place au dernier fade interne.

## Pièges connus

- Ne pas confondre timing de capture DOM et nom du PNG. Le nom du PNG est la timeline compensée pour
  FFmpeg.
- Ne pas supprimer le chevauchement `batch_start_idx = batch_end_idx - 1`.
- Ne pas réintroduire de `xfade` entre chunks dans `concat_internal_batch_videos()`.
- Ne pas compter la frame partagée deux fois dans la durée finale.
- Ne pas traiter une fin interne de merge visuel comme une blank réutilisable.
- Ne pas ajouter de frames au merge final pour "préparer" le chunk suivant: ça décale l'audio.

## Checklist avant de modifier l'export

1. Vérifier si le changement concerne les captures frontend ou le rendu Rust.
2. Si le bug est visuel sur une frame précise, inspecter le PNG source avant d'accuser FFmpeg.
3. Si le bug apparaît seulement entre chunks, inspecter les logs `images start..end`.
4. Si l'audio se décale progressivement, chercher une durée ajoutée ou retirée à chaque chunk.
5. Si la RAM explose au merge, vérifier qu'on est bien dans le chemin stream-copy.
6. Si la première transition d'un chunk manque, vérifier la frame partagée et
   `batch_start_completed_fade_ms`.
7. Relancer au minimum `cargo check` après modification Rust.
