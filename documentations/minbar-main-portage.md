# Portage du socle commun de main vers Minbar Caption

Références de cette passe : `main` à `7f711bc9`, Minbar à `f74b3c11` après la séparation des modèles
de transcription. Le portage est fonctionnel : les modifications sont adaptées aux fichiers Minbar,
sans fusionner les modèles de sous-titres ni remplacer les services de transcription.

## Changements portés

| Domaine            | Comportement obtenu                                                                                                                                                                                                                                                                        | Commits source                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Réglages           | Réparer les anciens états UI et les dimensions invalides avant leur publication ; compléter les nouveaux raccourcis sans écraser ceux de l'utilisateur.                                                                                                                                    | `ee9e6bfc`, `3429f2a5`, `71a564ae`                                                             |
| Création de projet | Choisir paysage, portrait, carré ou dimensions libres et une résolution de 720p à 4K ; appliquer la mise en page initiale adaptée à l'orientation, y compris aux traductions ajoutées ensuite.                                                                                             | `1f068457`                                                                                     |
| Lecture            | Barre de recherche temporelle, sauts de dix secondes, reprise depuis le début après la fin ; contrôles plein écran masqués après deux secondes d'inactivité.                                                                                                                               | `17914d44`, `060de238`, `9b96f2f7`                                                             |
| Édition            | Raccourcis configurables vers les quatre modes d'édition au curseur et les segments à vérifier ; quitter l'édition lors de la suppression du sous-titre concerné.                                                                                                                          | `71a564ae`, `3429f2a5`, `1b16cf00`                                                             |
| Médias             | Rotation et cadrage par clip, cadre vidéo par clip ; même transformation dans la prévisualisation et l'export FFmpeg, avec cache distinct par transformation.                                                                                                                              | `3fc23126`, `85e4b182`                                                                         |
| Presets            | Conserver l'onglet actif, les transitions, le cadrage, les valeurs locales et les images clés de ces réglages pendant l'import.                                                                                                                                                            | `231eca5a`, `e186f2bb`, `85e4b182`                                                             |
| Audio              | Effets de nettoyage, clarté, écho et réverbération avec préécoute ; accès depuis le menu d'un clip ; remplacement de source annulable et contrôle du projet propriétaire.                                                                                                                  | `7d3d1ec4`, `b7ad8b24`, `f2d15d2b`                                                             |
| Téléchargements    | Extraits temporels, qualité audio/vidéo, vidéo sans audio et découpe précise ; conserver ces options pour retélécharger un asset. Progression des médias stock et ajout des vidéos téléchargées à la timeline.                                                                             | `9f96d05d`, `71456708`, infrastructure de progression de `main`                                |
| Médias historiques | Retirer la conversion CBR, son avertissement et ses commandes devenues inutiles, comme dans le moteur commun.                                                                                                                                                                              | partie média de `f8dcfb09`                                                                     |
| Prévisualisation   | Tenir compte des dimensions locales des sous-titres ; poignée centrale de déplacement ; signaler les collisions et reconnaître les éditions importées contenant des espaces ; préserver les traductions sources pendant les merges visuels.                                                | `67dcd1db`, `ba5d0c72`, `957b4cd7`, `7cac42d8`, partie déplacement de `7d3d1ec4`               |
| Apparence          | Arrondi des barres de fond ; miniatures vidéo de pleine hauteur ; distinction des sous-titres prédéfinis et atténuation des clips de silence.                                                                                                                                              | `28aa1423`, `148709fb`, `c177ff1b`                                                             |
| Export             | Respecter les frontières des clips média dans les captures ; ignorer le flou lorsque l'overlay est désactivé ; conserver les polices du texte personnalisé ; nettoyer et réutiliser le contexte de capture ; afficher le nombre de captures et écrire les logs par lots dans des fichiers. | `3fc23126`, `a859c279`, `56849b95`, `eeccd30a`, `1d8655e1`, `c66d30cc`, `544082f9`, `c1ab59fd` |
| Performances UI    | Option de fond assombri des modales et sauvegarde automatique différée pendant leur ouverture.                                                                                                                                                                                             | `22447da8`, `6778cdc2`                                                                         |
| Distribution       | Corriger le lien OpenSSL obsolète sur macOS et embarquer les plugins GStreamer dans les AppImages, y compris dans le workflow Minbar.                                                                                                                                                      | `1ecd2167`, `3b8be213`                                                                         |

Les modifications de projet continuent d'utiliser `ProjectHistoryManager`. Les opérations audio et
stock conservent leur projet d'origine pendant les appels asynchrones. Les nouveaux contrôles de
style réutilisent les composants et les métadonnées JSON existants ; leur ajout aux anciens projets
passe par `ensureStylesSchemaUpToDate()`. Les traductions propres aux passages coraniques et aux
citations de Minbar restent disponibles. Les nouveaux textes sont dans le dictionnaire anglais,
seule langue activée sur cette branche.

## Changements conservés propres à chaque produit

- Le modèle `SubtitleClip` de Minbar reste un texte libre avec intervenant, traductions et
  alignement. Les anciens sous-titres canoniques restent pris en charge par `QuranSubtitleClip`.
- Les changements Zipformer, Multi-Aligner, riwayat, numérotation canonique, calligraphies, export
  par sens et répétitions Hifz de Quran Caption ne remplacent pas la transcription et le nettoyage
  Minbar. L'ajout JSON de `7f711bc9` dépend de l'assistant canonique de Quran Caption et reste dans
  ce périmètre.
- Les filtres de traduction Minbar utilisent ses statuts de traduction libre ; le correctif
  `95be6ef4` concernant le statut Quran Caption `fetched` ne s'y applique pas.
- Les workflows de batches coraniques, QuranReflect, la promotion Quran Caption, son catalogue de
  traductions et sa localisation arabe complète ne sont pas importés dans le produit Minbar.
- Le nom, la version, les mises à jour `MC` et les données propres à Minbar sont conservés. Les
  restructurations de fichiers de `18171794` ne sont pas recopiées sur le modèle Minbar remis au
  propre.

Plusieurs améliorations communes étaient déjà présentes sous des commits Minbar différents : lecteur
Rodio, vitesse de lecture, images temporisées, export Balanced/NVENC, suppression multiple d'assets,
packaging des projets et styles de mots notamment. Leurs commits source ne sont pas réappliqués.

## Vérification

Les contrôles de cette passe portent sur les types Svelte/TypeScript, les tests serveur, les
parcours de téléchargement et de création, les contrôles de lecture, les effets audio avec undo et
changement de projet, le flux de transcription Minbar, les collisions et l'égalité des captures PNG
réutilisées. Résultats : 449 tests serveur passent ; 41 tests d'interface ciblés passent. Le
contrôle Svelte/TypeScript ne signale aucune erreur ni aucun avertissement. ESLint ne signale aucune
nouvelle anomalie sur les fichiers concernés. La suite historique `VideoOverlay` conserve ses 24
échecs et ses deux erreurs de fixture déjà identifiés avant portage, avec 29 tests réussis.

Aucun build, génération manuelle i18n ou commit n'est exécuté. Les changements natifs sont formatés
avec `rustfmt` ; la compilation et les essais d'export dans les applications natives restent à
réaliser. Le portage n'ajoute aucune dépendance.
