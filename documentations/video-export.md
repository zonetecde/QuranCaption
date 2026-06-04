# Exportation vidéo

Cette documentation décrit le pipeline d'export vidéo actuel. Elle est volontairement
opérationnelle: l'objectif est qu'une future session puisse comprendre pourquoi les captures, les
batchs et les transitions sont faits de cette façon sans devoir reconstituer tout l'historique.

## Fichiers principaux

- `src/routes/exporter/+page.svelte`: fenêtre d'export, calcul des timings frontend, capture des
  PNG, duplication des PNG, appel Tauri `export_video`.
- `src/lib/services/ExportCaptureTiming.ts`: logique pure qui décide quels instants doivent être
  matérialisés en captures.
- `src-tauri/src/exporter/commands.rs`: scan des PNG, batching, rendu FFmpeg, concat/mux final.
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

## Rendu FFmpeg d'un batch

La fonction principale de rendu d'un batch est `render_ffmpeg_filter_complex_single()`.

Elle donne chaque PNG à FFmpeg comme une entrée image indépendante, loopée uniquement sur la durée
nécessaire au segment. Cela évite de convertir toute la timeline du batch en un flux vidéo complet,
puis de le dupliquer avec `split`.

Pour chaque image:

1. FFmpeg lit le PNG comme un flux court loopé à la durée du segment.
2. Le flux est redimensionné, paddé, converti au FPS cible et trimé.
3. Le segment RGBA est prémultiplié.
4. Les segments sont chaînés avec `xfade=transition=fade`.
5. Le résultat est overlay sur le fond vidéo ou sur un fond noir.
6. Si l'export est transparent, l'overlay est rendu avec alpha.

Le `xfade` est donc appliqué entre les captures à l'intérieur d'un batch. C'est la seule place où
les transitions normales entre images doivent être créées.

## Background vidéo et audio

Les vidéos de fond sont prétraitées avant le rendu des batchs quand elles existent. Les batchs
réutilisent ensuite ce fond prétraité via un trim local.

L'audio n'est pas injecté dans les batchs internes. Les batchs sont rendus sans audio, puis l'audio
est ajouté à la fin pendant le mux final. Cela évite de multiplier les traitements audio et limite
les risques de décalage.

## Rôle du batch size

Le batch size limite le nombre cible de captures dans un rendu FFmpeg interne.

Important: ce n'est pas un nombre de frames vidéo, et ce n'est pas un nombre de traitements
parallèles. Un `batch_size` de `4` veut dire "essayer de rendre environ 4 captures PNG par batch".

Le batch size est volontairement non strict:

- il est clampé entre 2 et 64;
- les batchs non finaux partagent une capture avec le batch suivant;
- si toutes les captures tiennent dans la limite, il n'y a pas de batching.

Pourquoi batcher: un gros filtergraph avec des centaines de captures crée beaucoup d'entrées,
xfades et labels FFmpeg. Ça peut consommer énormément de RAM, ralentir ou planter. Les batchs
limitent la taille des filtergraphs.

## Quand un batch peut s'arrêter

Le merge final des batchs ne doit pas créer de transition visuelle. Il assemble des vidéos déjà
rendues. Les transitions doivent donc être terminées à l'intérieur des batchs eux-mêmes.

Regle actuelle:

```text
un batch non final peut finir à l'index i et le batch suivant reprend à ce même index i.
```

Cette frontière est choisie par `choose_shared_batch_end_idx()`:

- on coupe à la limite cible du batch size;
- on garde la dernière image du batch précédent comme première image du batch suivant;
- la capture partagée sert uniquement de référence visuelle pour reconstruire la transition
  suivante.

Exemple:

```text
batch 0: image[0] ... image[11]
batch 1: image[11] ... image[22]
batch 2: image[22] ... image[33]
```

Il n'y a plus de détection de deux captures consécutives identiques. La coupure peut être faite
n'importe où tant que cette capture commune existe.

## Pourquoi utiliser une frame partagée

Le batch suivant a besoin de l'image précédente pour construire son premier `xfade`. Sans image
commune, il commencerait directement sur l'image suivante et la transition visible entre les deux
captures serait perdue.

La frame partagée résout ce problème sans ajouter de fondu au merge final:

- le batch précédent rend jusqu'à la capture de frontière;
- le batch suivant reprend depuis cette même capture;
- le premier `xfade` du batch suivant va de la capture partagée vers la capture suivante;
- la durée de la capture partagée n'est pas comptée deux fois dans la vidéo finale.

Cela évite aussi de créer des PNG synthétiques seulement pour trouver une frontière de batch. Les
fichiers source restent les captures réelles de la timeline, et Rust se contente de les regrouper en
batchs avec chevauchement.

## Chevauchement entre batchs

Après chaque batch non final:

```rust
batch_start_idx = batch_end_idx - 1;
```

Le batch suivant reprend donc sur la dernière capture du batch précédent. C'est indispensable:

- ça donne au batch suivant une première image de référence;
- ça permet de reconstruire sa première transition interne;
- ça évite d'avoir besoin d'un `xfade` entre fichiers batchs pendant le merge.

Le code conserve aussi `batch_start_completed_fade_ms`. Il sert à ajuster les timestamps locaux du
batch suivant pour tenir compte du fade déjà consommé à la frontière. Cette compensation est ce qui
empêche la frame commune d'ajouter du temps en double. Sans elle, les durées des batchs peuvent
s'accumuler avec un décalage audio/vidéo.

## Durées des batchs

Les durées ne sont pas déduites uniquement du nombre d'images. Elles sont calculées avec la timeline
compensée:

- `capture_timeline_ms(timestamp, image_index, fade_duration)` retire les fades déjà complètes;
- `cumulative_frames_for_time_ms()` convertit le temps en frame count selon le FPS;
- `frames_to_seconds()` force une durée exacte en secondes;
- `duration_s_override` force FFmpeg à rendre exactement la durée attendue du batch.

But: la somme des batchs doit rester égale à la durée finale, sans ajouter de frames invisibles qui
décaleraient progressivement l'audio.

## Merge final des batchs

Le merge final se fait dans `concat_internal_batch_videos()`.

Cas rapide, le plus important:

- si pas de fade vidéo global et pas d'export transparent, les batchs sont concaténés avec le concat
  demuxer FFmpeg et `-c copy`;
- si l'audio existe, on concatène d'abord la vidéo temporaire en stream-copy, puis on mux l'audio
  avec `mux_video_copy_with_audio()`;
- le stream-copy évite de réencoder et ne charge pas tous les batchs en RAM.

Cas fallback:

- si un fade vidéo global est demandé, ou si l'export transparent impose un traitement vidéo, FFmpeg
  utilise un filtergraph de concat simple;
- ce fallback ne doit pas réintroduire de `xfade` entre batchs.

Invariant important: les transitions entre captures appartiennent aux batchs. Le merge final ne doit
pas inventer de transition entre fichiers batchs.

## Pourquoi il ne faut pas faire de `xfade` au merge

Un `xfade` entre batchs a plusieurs problèmes:

- il force FFmpeg à charger beaucoup d'entrées batchs dans un gros filtergraph;
- avec beaucoup de batchs, la RAM peut exploser;
- la ligne de commande peut devenir trop longue si on passe tous les fichiers en inputs directs;
- ajouter du padding ou des frames au merge peut créer un décalage audio/vidéo cumulatif;
- le fade est moins précis car il agit sur des vidéos déjà rendues, pas sur les captures source.

La bonne architecture actuelle est:

```text
captures PNG -> fades internes dans chaque batch -> concat/mux final sans fade inter-batch
```

## Progression export

Le frontend émet la progression pendant la capture des frames. Rust émet ensuite la progression
FFmpeg via `run_ffmpeg_command()` et `-progress pipe:2`.

Les étapes importantes visibles côté UI sont:

- capture des frames;
- adding subtitles, pendant le rendu FFmpeg des batchs;
- merging files, pendant concat/mux final.

Pendant le batching, `progress_base_s`, `progress_total_s` et `local_duration_s` permettent de
rapporter la progression locale d'un batch dans la timeline globale.

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
[perf] batch_size=<n>
[batching] <n> image(s), limite <batch_limit>, rendu interne en batchs
[batching] <n> timing(s) blank disponibles pour le rendu
[batching] batch <idx>: images <start>..<end> ... encoded_duration=<s>
[batching] concat stream-copy: <n> fichier(s) -> <output>
```

Pour diagnostiquer une coupure visible entre deux batchs, regarder:

- `images start..end` du batch précédent;
- `images start..end` du batch suivant;
- si le `end` du précédent est bien le `start` du suivant;
- si la transition attendue se trouve dans le batch qui commence sur cette image partagée;
- si la durée forcée du batch laisse assez de place au dernier fade interne.

## Pièges connus

- Ne pas confondre timing de capture DOM et nom du PNG. Le nom du PNG est la timeline compensée pour
  FFmpeg.
- Ne pas supprimer le chevauchement `batch_start_idx = batch_end_idx - 1`.
- Ne pas réintroduire de `xfade` entre batchs dans `concat_internal_batch_videos()`.
- Ne pas compter la frame partagée deux fois dans la durée finale.
- Ne pas traiter une fin interne de merge visuel comme une blank réutilisable.
- Ne pas ajouter de frames au merge final pour "préparer" le batch suivant: ça décale l'audio.

## Checklist avant de modifier l'export

1. Vérifier si le changement concerne les captures frontend ou le rendu Rust.
2. Si le bug est visuel sur une frame précise, inspecter le PNG source avant d'accuser FFmpeg.
3. Si le bug apparaît seulement entre batchs, inspecter les logs `images start..end`.
4. Si l'audio se décale progressivement, chercher une durée ajoutée ou retirée à chaque batch.
5. Si la RAM explose au merge, vérifier qu'on est bien dans le chemin stream-copy.
6. Si la première transition d'un batch manque, vérifier la frame partagée et
   `batch_start_completed_fade_ms`.
7. Relancer au minimum `cargo check` après modification Rust.
