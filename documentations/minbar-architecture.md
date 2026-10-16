# Architecture métier de Minbar Studio

Minbar Studio réutilise le moteur multimédia et les outils Quran de Quran Caption. Son modèle de
transcription est indépendant : un sous-titre contient du texte, un intervenant, un alignement, des
traductions et des éditions locales. Il n'est pas défini par une sourate ou un verset.

## Modèles et moteur

- `src/lib/classes/clips/SubtitleClip.svelte.ts` définit le sous-titre Minbar. Son constructeur
  reçoit explicitement ses traductions et ne consulte pas le projet actif.
- Les classes communes de clips, les textes prédéfinis et les éléments personnalisés ont leurs
  propres modules dans `classes/clips`. `classes/Clip.svelte.ts` conserve les anciens imports du
  moteur comme point d'entrée.
- `src/lib/types/transcription.ts` décrit les échanges avec les moteurs vocaux, sans dépendance
  Svelte, Tauri ou interface. Les timings d'un résultat vocal sont absolus et exprimés en secondes ;
  ceux de `alignmentMetadata.words` sont relatifs au début du clip. Les clips utilisent les
  millisecondes sur la timeline.
- `src/lib/services/TranscriptTiming.ts` normalise ces timings sans état applicatif.
- `src/lib/compatibility/QuranSubtitleClip.svelte.ts` adapte les anciens segments orientés versets.
  Les outils du moteur qui nécessitent des indices canoniques doivent vérifier cet adaptateur
  explicitement. Les transcriptions courantes utilisent `SubtitleClip`, y compris lorsqu'elles
  contiennent des annotations Quran ou des citations.

## Contenu annoté

Les annotations Minbar restent dans le texte : `{{2:255}}`, `{{2:255:2-4}}` ou `{{citation}}`.

- `TranscriptMarkup.ts` interprète cette syntaxe sans charger de corpus, de police ou de projet.
- `TranscriptReferenceService.ts` résout et valide les références dans le corpus local et les
  prépare pour les exports.
- `components/projectEditor/videoPreview/helpers/transcriptReferences.ts` gère leur présentation :
  polices, CSS et rafraîchissement de l'aperçu. La logique de traitement ne doit pas en dépendre.

## Traitements et interface

`TranscriptionRuntimeSession.svelte.ts` pilote l'installation et la reconnaissance vocale.
`TranscriptCleanupSession.svelte.ts` possède le résultat, les intervenants nommés, les lots de
nettoyage, les abonnements de progression et la reprise enregistrée dans le projet.

La modale présente ces sessions et gère sa navigation, ses champs et les écoutes de voix. Les
sessions capturent le projet au départ : une réponse tardive ne peut pas modifier un autre projet.
Leur destruction détache les événements et arrête la planification de nouveaux lots de nettoyage ;
elle ne prétend pas interrompre une requête fournisseur déjà partie.

`SpeakerLibrary.ts` gère les intervenants et leurs mutations annulables. La demande de confirmation
et le montage de la modale appartiennent à `components/modals/speakerRemoval.ts`.

## Conservation des projets et des éditions

Le registre de sérialisation applique la migration des anciens `SubtitleClip` avant de restaurer
leurs instances. Les anciennes données orientées versets passent par l'adaptateur ; les champs Quran
vides des transcriptions Minbar sont retirés. Les noms des autres classes sérialisées et le format
des paquets projet sont conservés.

Une nouvelle transcription audio peut être segmentée librement. Le nettoyage de sous-titres déjà
édités transporte leurs `clipId` et conserve leurs limites. L'application du résultat réutilise ces
identifiants et copie leurs traductions, images, styles en ligne et indicateurs d'édition. Les
réglages de styles indexés par identifiant restent ainsi associés aux mêmes sous-titres. Une
traduction dont le texte source a changé est signalée pour révision, avec son contenu conservé.

Les mutations de clips, d'intervenants et de points de reprise passent par `ProjectHistoryManager`.
Les états de progression temporaires restent dans les sessions, sans être sérialisés avec le projet.

## Vérification

Utiliser `npm run check`, `npm run test:unit -- --run` et les tests navigateur des parcours
modifiés. Les tests couvrent notamment la migration des projets, la conservation des éditions,
undo/redo, les erreurs avant lancement et les réponses reçues après destruction d'une session.
