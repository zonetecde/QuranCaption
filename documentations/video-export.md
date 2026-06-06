# Exportation video

Cette documentation decrit le pipeline d'export video actuel. Elle se concentre sur le chemin rapide
utilise par defaut dans `src-tauri/src/exporter/commands.rs`.

## Fichiers principaux

- `src/routes/exporter/+page.svelte`: fenetre d'export, calcul des timings frontend, capture des
  PNG, duplication des PNG, appel Tauri `export_video`.
- `src/lib/services/ExportCaptureTiming.ts`: logique pure qui decide quels instants doivent etre
  materialises en captures.
- `src-tauri/src/exporter/commands.rs`: scan des PNG, generation du plan TGA, graphe FFmpeg final,
  mux audio/video.
- `src-tauri/src/exporter/filter_graph.rs`: ancien graphe de fallback, conserve pour les cas qui ne
  passent pas par le chemin rapide.

## Vue generale

L'export ne capture pas chaque frame depuis le DOM. Le frontend capture seulement les etats visuels
importants de l'overlay, puis Rust reconstruit la video finale.

Pipeline actuel:

```text
captures PNG timestampées -> plan overlay TGA -> FFmpeg -> fichier final
```

Les PNG sont nommes avec leur timestamp en millisecondes dans la timeline compensee, par exemple:

```text
0.png
280.png
1000.png
1781.png
```

Rust trie les fichiers par stem numerique. La premiere image doit etre `0.png`.

## Timeline et fondus

Le frontend compense deja les timestamps des captures pour tenir compte des fondus. Cote Rust, le
plan TGA respecte cette timeline et consomme le fade precedent comme l'ancien `xfade`, afin d'eviter
un decalage progressif entre l'audio et la video.

Le log utile est:

```text
[fast_export] fade timeline effectif=<n>ms
```

La duree du fondu est limitee par la duree disponible du segment. Un segment trop court ne doit pas
forcer une transition plus longue que son espace temporel.

## Generation du plan overlay TGA

L'etape `Initializing...` cote UI correspond a:

```text
[fast_export] Initialisation: generation du plan overlay TGA...
```

Cette etape transforme les PNG timestampes en un concat FFmpeg de frames TGA:

- les images fixes sont referencees directement;
- les frames intermediaires de fondu sont generees en TGA;
- la taille d'origine des frames est conservee;
- l'alpha est preserve pour les exports transparents ou les exports avec video de fond;
- en export visible sans video de fond, les frames peuvent etre composees sur noir pour accelerer le
  chemin direct.

Les fondus sont calcules cote Rust pour eviter de creer un enorme filtergraph `xfade` dans FFmpeg.

## Optimisation par tuiles

Pendant les fondus, Rust ne blend pas toujours toute l'image. Il detecte les zones modifiees entre
deux PNG et regroupe les pixels changes en tuiles de `16x16`.

But:

- eviter de recalculer les grands aplats transparents ou statiques;
- accelerer les captions qui occupent seulement une petite partie du 1920x1080;
- conserver la meme timeline, meme quand deux images sont visuellement identiques.

Important: cette optimisation reduit le cout du blend, mais FFmpeg doit quand meme encoder une video
complete a la resolution finale.

## Chemin direct visible

Le chemin le plus rapide est utilise quand:

- l'export n'est pas transparent;
- il n'y a pas de video de fond;
- les frames sont opaques ou composees sur noir;
- il n'y a pas de fade video global;
- l'audio est absent ou simple.

Dans ce cas, FFmpeg lit directement le concat TGA et encode la video sans filtre overlay:

```text
[fast_export] chemin direct eligible: export_visible=true, fond_video=false, ...
[fast_export] voie directe visible sans filtre overlay
```

Si un seul fichier audio compatible est fourni (`mp3`, `aac`, `m4a` vers `mp4`, `mov` ou `m4v`),
l'audio est copie sans reencodage:

```text
[fast_export] audio direct: copie sans reencodage
```

Sinon, l'audio repasse en AAC.

## Video de fond

Quand une video de fond existe, le chemin direct est ignore. Rust preprocess la video de fond si
necessaire, puis FFmpeg compose:

```text
fond normalise + overlay premultiplie -> video finale
```

L'overlay garde son alpha. Le graphe applique:

```text
premultiply -> overlay alpha=premultiplied
```

Si la video de fond est plus courte que la duree exportee, elle n'est pas prolongee en clonant sa
derniere frame. Le reste de la video est rempli avec un fond noir, puis concatene au fond existant.

## Export transparent

Quand `export_without_background=true`, l'overlay n'est pas compose sur un fond noir.

Formats principaux:

- MOV alpha: sortie en `argb`;
- WebM alpha: sortie en `yuva420p`.

Dans ce mode, les fades video globaux utilisent `alpha=1` pour agir sur l'alpha de l'overlay.

## Audio

L'audio est ajoute dans le graphe final.

Cas rapide:

- un seul fichier audio;
- pas de fade audio;
- conteneur compatible;
- codec audio compatible avec le conteneur.

Dans ce cas, l'audio est stream-copy. Cela evite que l'ajout d'un MP3 double le temps d'export.

Cas complexe:

- plusieurs audios;
- fade audio in/out;
- codec ou conteneur incompatible.

Dans ce cas, FFmpeg concatene ou filtre l'audio puis encode en AAC.

## Progression

Le frontend gere la progression pendant la capture des PNG. Rust emet ensuite la progression via
`run_ffmpeg_command()` et `-progress pipe:2`.

Etapes visibles importantes:

- capture des frames;
- `Initializing...`, pendant la generation du plan TGA;
- creation de la video finale, pendant FFmpeg.

## Logs utiles

Logs frontend:

```text
Normal export - Timings detectes: [...]
Waiting for frame at <timing>ms...
Screenshot saved to: ...
Normal export: Screenshot taken at timing <timing> -> image <imageIndex>
```

Logs Rust:

```text
[scan] <n> image(s) trouvee(s)
[timeline] Premiers timestamps: [...]
[fast_export] Initialisation: generation du plan overlay TGA...
[fast_export] fade timeline effectif=<n>ms
[fast_export] Frames source=<n> fades=<n> taille_source=<w>x<h> opaque=<bool> compose_noir=<bool>
[fast_export] chemin direct eligible: ...
[fast_export] chemin direct ignore: ...
[fast_export] audio direct: copie sans reencodage
```

## Pieges connus

- Ne pas confondre timing de capture DOM et nom du PNG. Le nom du PNG est la timeline compensee pour
  les fondus.
- Ne pas supprimer la consommation du fade precedent dans le plan TGA, sinon l'audio se decale.
- Ne pas opacifier les frames quand une video de fond existe: l'overlay doit garder son alpha.
- Ne pas prolonger une video de fond courte avec `tpad=clone`, sinon la derniere frame reste figee
  jusqu'a la fin.
- Ne pas reencoder l'audio simple quand un stream-copy suffit.
- Ne pas supposer que les tuiles reduisent le cout d'encodage FFmpeg: elles optimisent surtout la
  generation des frames de fondu.

## Checklist avant modification

1. Verifier si le changement concerne les captures frontend, le plan TGA ou le graphe FFmpeg.
2. Si le bug est visuel, inspecter le PNG source avant d'accuser FFmpeg.
3. Si l'audio se decale, verifier la consommation des fades dans le plan TGA.
4. Si l'export est lent avec audio simple, verifier que le stream-copy est pris.
5. Si une video de fond courte fige, verifier que la queue noire est bien generee.
6. Relancer au minimum `cargo check --manifest-path src-tauri/Cargo.toml` apres modification Rust.
