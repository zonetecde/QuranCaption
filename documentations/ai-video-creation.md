# AI Video Creation (POC)

Feature de creation automatisee de projets QuranCaption via un prompt utilisateur. L'IA choisit les
versets, le recitateur, genere un prompt video, et le pipeline automatise toute la creation du
projet jusqu'a obtenir un projet pret avec sous-titres segmentes et traductions trimees.

**Branche** : `prompt-v2` **Statut** : POC (Proof of Concept)

---

## Vue d'ensemble

L'utilisateur entre un theme/sujet (ex: "patience dans l'epreuve"), et le systeme :

1. Demande a l'IA de generer un plan (versets, recitateur, prompt video, titre)
2. Affiche un ecran de review ou l'utilisateur peut ajuster les parametres
3. Execute un pipeline automatise de creation de projet en arriere-plan

Le resultat final est un projet QuranCaption complet avec audio, sous-titres arabes segmentes, et
traductions trimees par l'IA.

---

## Architecture des fichiers

```
src/lib/components/aiVideo/
  AiVideoPage.svelte                 # Page principale, logique du pipeline
  AiVideoPromptField.svelte          # Champ de saisie du prompt utilisateur
  AiVideoGenerationOptions.svelte    # Options: modele video, resolution, etc.
  AiVideoQuranSourceSettings.svelte  # Config source Quran (recitateur, sourate, versets)
  AiVideoVerseRangePreview.svelte    # Preview des versets selectionnes
```

### Fichiers modifies hors du dossier aiVideo

- `src/lib/runes/main.svelte.ts` — ajout de `aiVideoGenerationStatus` dans `GlobalState` pour
  l'overlay
- `src/routes/+page.svelte` — ajout de l'overlay global qui s'affiche pendant la generation

---

## Flux utilisateur (2 etapes)

### Etape 1 : Input (step = `'input'`)

L'utilisateur configure :

| Champ                          | Description                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `prompt`                       | Theme/sujet pour la video (texte libre)                       |
| `selectedModel`                | Modele de generation video (placeholder pour l'instant)       |
| `resolution`                   | Portrait ou paysage                                           |
| `letAiChoose`                  | Si true, l'IA choisit le recitateur et les versets            |
| `selectedTranslation`          | Edition de traduction a appliquer (ex: `fra-muhammadhameedu`) |
| Recitateur / Sourate / Versets | Config manuelle si `letAiChoose` est false                    |

Au clic sur "Generate", `handleGeneratePlan()` est appele :

- Appelle `generateAiPlan()` qui envoie le prompt + la liste complete des recitateurs MP3Quran a
  l'API OpenAI
- L'IA retourne un JSON avec : `title`, `videoPrompt`, `reciterId`, `moshafId`, `reciter`, `surah`,
  `ayahStart`, `ayahEnd`
- Les valeurs sont injectees dans l'ecran de review
- Le `reciterId`/`moshafId` retournes sont resolus en `ReciterOption` via `resolveReciterOption()`
  (avec fallback chain)

### Etape 2 : Review (step = `'review'`)

L'utilisateur voit et peut modifier :

- Le titre du projet (genere par l'IA, max 50 caracteres)
- Le prompt video
- Le recitateur choisi
- La sourate et la plage de versets
- Preview des versets arabes

Au clic sur "Create Project", `handleCreateProject()` execute le pipeline complet.

---

## Pipeline de creation (`handleCreateProject`)

Le pipeline est entierement automatise. Un overlay global (z-index 99999) affiche le statut courant
par-dessus l'editeur de projet.

**Probleme resolu** : Le composant `AiVideoPage` est demonte quand on navigue vers l'editeur (car
`+page.svelte` rend `ProjectEditor` des que `globalState.currentProject` existe). Pour contourner :

- Toutes les valeurs reactives sont **snapshottees** avant la navigation
- Le statut est affiche via `globalState.aiVideoGenerationStatus` dans un overlay rendu par
  `+page.svelte`

### Etapes du pipeline

```
1. Creer le projet
   - Nom : "AI - <titre>" (titre genere par l'IA, max 50 chars)
   - ProjectDetail + ProjectContent + Project
   - Navigation vers l'editeur (overlay s'affiche)

2. Telecharger la recitation
   - Source : MP3Quran (URL = `${moshaf.server}${surahId.padStart(3,'0')}.mp3`)
   - Ou copie d'un fichier audio local

3. Trimmer l'audio au range de versets
   - Recupere les timings via Mp3QuranService.getSurahTiming(moshafId, surahId)
   - Appelle la commande Tauri `cut_audio` (FFmpeg) avec start_ms/end_ms
   - Resultat : fichier audio trimme dans le dossier du projet

4. Ajouter l'audio a la timeline
   - content.addAsset() + addToTimeline(false, true)

5. Generer les sous-titres avec l'IA (segmentation)
   - Appelle runAutoSegmentation({}, 'api') — segmentation cloud
   - Produit les clips de sous-titres arabes alignes sur l'audio
   - Fallback automatique CPU si quota GPU epuise

6. Ajouter la traduction
   - Telecharge les traductions via getAllProjectSubtitlesTranslations()
   - Applique via ProjectTranslation.addTranslation(edition, translations)

7. Trimmer les traductions avec l'IA (Advanced AI Trimmer v2)
   - buildAdvancedTrimVerseCandidates() : identifie les segments non-complets qui ont besoin de trim
   - buildAdvancedTrimBatches() : regroupe en batches pour l'API
   - runAdvancedTrimBatchStreaming() : appel streaming a l'API OpenAI via commande Tauri Rust
   - validateAdvancedTrimBatchResult() : valide la reponse
   - applyAdvancedTrimValidationSuccess() : applique les traductions trimees aux clips
   - Modele par defaut : settings utilisateur, sinon `gpt-5.4` avec reasoning effort `none`

8. Finalisation
   - Sauvegarde du projet
   - Suppression de l'overlay
```

---

## Mode Debug

Un flag `AI_VIDEO_DEBUG = true` dans `AiVideoPage.svelte` permet de :

- Skip l'appel API de generation de plan et retourner un `MOCK_AI_PLAN` en dur
- Eviter de depenser des tokens pendant les tests
- Mock actuel : Sourate 1 (Al-Fatiha), versets 3-7, recitateur Abdulrahman Alsudaes

Pour desactiver : mettre `AI_VIDEO_DEBUG = false`.

---

## Overlay de statut

Pendant l'execution du pipeline, un overlay global est affiche au-dessus de tout (y compris
l'editeur de projet).

**Mecanique** :

- `globalState.aiVideoGenerationStatus` (string) est mis a jour a chaque etape
- `+page.svelte` rend un div `fixed inset-0 z-[99999]` quand cette string est truthy
- L'overlay contient : icone, titre "Creating your project...", texte de statut, barre de
  progression animee
- L'overlay disparait quand le pipeline est termine (string remise a `''`)

---

## Resolution des recitateurs (MP3Quran)

Au `onMount`, tous les recitateurs MP3Quran sont charges et transformes en `ReciterOption[]`.

Quand l'IA choisit un recitateur, `resolveReciterOption(reciterId, moshafId, surahId)` tente de le
resoudre avec une chaine de fallback :

1. Match exact : meme reciterId + moshafId + la sourate est disponible
2. Meme reciteur, autre moshaf qui a la sourate
3. Meme reciteur, n'importe quel moshaf

La liste des recitateurs est aussi injectee dans le prompt systeme de l'IA pour qu'elle choisisse
parmi les IDs valides.

---

## AI Translation Trimmer v2 — Integration

Le trimmer utilise le pipeline existant de `AdvancedAITrimming.ts` adapte pour le contexte
automatise :

1. **Candidates** : `buildAdvancedTrimVerseCandidates(edition, false)` — recupere les segments de
   sous-titres qui ne sont pas des versets complets et dont la traduction doit etre trimee
2. **Batches** : regroupe les candidats selon la taille du modele
3. **Streaming** : appel via la commande Tauri `run_advanced_ai_trim_batch_streaming` (Rust) qui
   gere le streaming SSE de l'API OpenAI
4. **Validation + Application** : verifie la reponse parsee et applique les traductions trimees aux
   clips

Le modele et le reasoning effort utilisent les settings utilisateur
(`aiTranslationSettings.advancedTrimModel` / `advancedTrimReasoningEffort`) avec fallback sur
`gpt-5.4` / `none`.

---

## Commandes Tauri utilisees

| Commande                               | Fichier Rust                               | Description                                                        |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `cut_audio`                            | `src-tauri/src/commands/media.rs`          | Trim audio via FFmpeg (source_path, start_ms, end_ms, output_path) |
| `run_advanced_ai_trim_batch_streaming` | `src-tauri/src/commands/ai_translation.rs` | Appel streaming API OpenAI pour le trim des traductions            |

Note : les parametres Tauri subissent une conversion automatique camelCase → snake_case.

---

## Dependances cles

- **MP3Quran API** : liste des recitateurs, URLs audio, timings par verset
- **API OpenAI** (ou compatible) : generation du plan IA + trim des traductions
- **Cloud Segmentation API** : segmentation audio → sous-titres arabes
- **FFmpeg** (via Tauri) : trim de l'audio

---

## TODO / Prochaines etapes

- [ ] Passer `AI_VIDEO_DEBUG` a `false` pour la production
- [ ] Integrer la generation video reelle (actuellement seul le prompt est genere)
- [ ] Gestion d'erreurs plus robuste (retry, resume du pipeline)
- [ ] UI pour editer le titre du projet dans l'ecran de review
- [ ] Support de plus de modeles video
