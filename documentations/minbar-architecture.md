# Architecture métier de Minbar Studio

Minbar Studio réutilise le moteur multimédia et les outils Quran de Quran Caption. Son modèle de
transcription est indépendant : un sous-titre contient du texte, un alignement, des traductions et
des éditions locales. Il n'est pas défini par une sourate ou un verset.

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
`TranscriptCleanupSession.svelte.ts` possède le résultat, les lots de nettoyage, les abonnements de
progression et la reprise enregistrée dans le projet.

La modale présente ces sessions et gère sa navigation, ses champs et les écoutes de voix. Les
sessions capturent le projet au départ : une réponse tardive ne peut pas modifier un autre projet.
Leur destruction détache les événements et arrête la planification de nouveaux lots de nettoyage ;
elle ne prétend pas interrompre une requête fournisseur déjà partie.

Chaque projet contient un seul intervenant, enregistré dans `ProjectDetail.speaker`. Les sous-titres
ne portent aucune affectation d'intervenant. Les anciennes affectations et listes d'intervenants
sont supprimées à la désérialisation, sans modifier les textes ni leurs timings.

Les lectures et mutations de transcription reçoivent leur `Project` explicitement. Les lectures
peuvent consulter un projet inactif ; les commandes annulables refusent de modifier un projet qui
n'est plus actif. Les réglages vocaux et linguistiques sont injectés dans les sessions.
`ProjectHistoryManager.track(label, mutation, project)` vérifie le propriétaire avant d'exécuter la
mutation. Les accès au projet actif qui protègent le cycle de vie restent aux frontières
applicatives.

`AudioEffectsService.ts` prépare la préécoute et traite la source audio. Il ajoute le nouvel asset
et remplace la source du clip dans une seule entrée d'historique, après le traitement natif. Une
fermeture, un changement de projet ou un remplacement de source rend le résultat obsolète. La modale
conserve la lecture Howler, les paramètres, les messages et le nettoyage du fichier de préécoute.

Les bornes d'un clip sont validées dans `Clip`. Les opérations qui ajustent aussi son voisin sont
portées par `Track.updateClipStartTime` et `Track.updateClipEndTime` : elles mettent à jour les
alignements des deux sous-titres et sont annulables ensemble. Le calcul de largeur en pixels
appartient à `timelineClipLayout.ts`, dans l'interface, et reçoit le projet affiché.

Les confirmations d'ajout d'assets et d'adaptation des dimensions appartiennent à
`assetsManager/assetTimelineActions.ts`. `Asset` expose ses erreurs d'analyse ; `AssetViewer` décide
de leur présentation. Le modèle ne monte plus de modale et ne consulte plus `globalState`.

Les dialogues d'import et de remise à zéro des styles, ainsi que la navigation vers une catégorie,
appartiennent à `presets/actions/styleActions.ts`. `StylePresetApplicationService.ts` prépare les
styles et les clips personnalisés sur des copies, puis les applique dans une transaction synchrone.
Les choix d'association de traductions sont des arguments de cette commande. Le preset source n'est
pas modifié. Les trois cibles Minbar et les transformations média sont conservées lors de l'import.

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

Les mutations de clips et de points de reprise passent par `ProjectHistoryManager`. Les états de
progression temporaires restent dans les sessions, sans être sérialisés avec le projet.

## Limites du découplage actuel

Le moteur hérité n'est pas entièrement indépendant de l'application : `Track` contient encore des
opérations Quran et des interactions d'interface ; `VideoStyle` conserve des accès au contexte de
rendu et certaines opérations sur les contenus personnalisés. `ProjectTranslation` regroupe encore
les langues Minbar, le téléchargement des traductions Quran et des commandes avec confirmation. Les
textes prédéfinis utilisent également le contexte de l'éditeur. Ces modules ne doivent pas être
présentés comme un domaine pur ; les nouvelles commandes de transcription n'ont pas à dépendre de
leurs interactions d'interface.

## Vérification

Utiliser `npm run check`, `npm run test:unit -- --run` et les tests navigateur des parcours
modifiés. Les tests couvrent notamment la migration des projets, la conservation des éditions,
undo/redo, les erreurs avant lancement et les réponses reçues après destruction d'une session.
`ProjectOperations.spec.ts` couvre aussi la propriété des données, le redimensionnement des voisins,
les effets audio devenus obsolètes et l'absence de mutation partielle lors de l'import de styles.
