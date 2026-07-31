<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import { ClipWithTranslation, type PredefinedSubtitleClip } from '$lib/classes/Clip.svelte';
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { automaticSplitSubtitleAtWord } from '$lib/services/AutoSegmentation';
	import {
		ensureManualWordByWordEditStateIsValid,
		moveManualWordByWordSelectedWordEndToCursor,
		moveManualWordByWordSelectedWordStartToCursor,
		moveManualWordByWordSelection,
		stampManualWordByWordCurrentWordAtCursor,
		syncManualWordByWordSelectionFromVerseWord,
		syncVerseSelectionWithManualWordByWordIndex
	} from '$lib/services/WbwHelper';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { showContextMenuInViewport } from '$lib/services/ContextMenuService';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	let subtitlesEditorState = $derived(() => globalState.getSubtitlesEditorState);
	let isWordDragging = $state(false);
	let didWordDrag = $state(false);
	let dragStartWordIndex = $state(-1);
	let suppressNextWordClick = $state(false);
	let wordContextMenu: ContextMenu | undefined = $state(undefined);
	let contextMenuWordIndex: number | null = $state(null);

	function goNextVerse() {
		if (
			subtitlesEditorState().selectedVerse <
			Quran.getVerseCount(subtitlesEditorState().selectedSurah)
		) {
			subtitlesEditorState().selectedVerse += 1;
			resetFirstAndLastWordIndex();
		} else {
			// go next surah
			if (subtitlesEditorState().selectedSurah < 114) {
				subtitlesEditorState().selectedSurah += 1;
				subtitlesEditorState().selectedVerse = 1;
				resetFirstAndLastWordIndex();
			}
		}
	}

	async function goPreviousVerse() {
		if (subtitlesEditorState().selectedVerse > 1) {
			subtitlesEditorState().selectedVerse -= 1;

			// Met le curseur à la fin du verset précédent
			// Récupère le verset précédent
			const previousVerse = await Quran.getVerse(
				subtitlesEditorState().selectedSurah,
				subtitlesEditorState().selectedVerse
			);
			if (previousVerse) {
				subtitlesEditorState().startWordIndex = previousVerse.words.length - 1;
				subtitlesEditorState().endWordIndex = previousVerse.words.length - 1;
			}
		} else {
			// go previous surah
			if (subtitlesEditorState().selectedSurah > 1) {
				subtitlesEditorState().selectedSurah -= 1;
				subtitlesEditorState().selectedVerse = Quran.getVerseCount(
					subtitlesEditorState().selectedSurah
				);

				// Met le curseur à la fin du verset précédent
				// Récupère le verset précédent
				const previousVerse = await Quran.getVerse(
					subtitlesEditorState().selectedSurah,
					subtitlesEditorState().selectedVerse
				);
				if (previousVerse) {
					subtitlesEditorState().startWordIndex = previousVerse.words.length - 1;
					subtitlesEditorState().endWordIndex = previousVerse.words.length - 1;
				}
			}
		}
	}

	let selectedVerse = $derived(
		async () =>
			await Quran.getVerse(
				subtitlesEditorState().selectedSurah,
				subtitlesEditorState().selectedVerse
			)
	);

	onMount(() => {
		document.addEventListener('mouseup', handleGlobalWordMouseUp);
	});

	onDestroy(() => {
		document.removeEventListener('mouseup', handleGlobalWordMouseUp);
		currentMenu.set(null);
	});

	/**
	 * Avance l'édition au sous-titre suivant si un ID de sous-titre est en attente (après une division).
	 * @param currentId L'ID du sous-titre actuellement édité.
	 * @returns true si l'édition a été avancée, false sinon.
	 */
	function advanceSplitEditIfNeeded(currentId: number | null): boolean {
		const pendingId = subtitlesEditorState().pendingSplitEditNextId;
		if (!pendingId) return false;

		subtitlesEditorState().pendingSplitEditNextId = null;

		if (currentId !== pendingId) {
			// Passe au sous-titre suivant
			const nextClip = globalState.getSubtitleTrack.getClipById(pendingId);
			if (nextClip) {
				// Modifie le sous-titre
				globalState.getSubtitlesEditorState.editSubtitle = nextClip as
					| SubtitleClip
					| PredefinedSubtitleClip
					| ClipWithTranslation;
				return true;
			}
		}

		globalState.getSubtitlesEditorState.editSubtitle = null;
		return true;
	}

	/**
	 * Définit la fin du sous-titre sous le curseur, ou du dernier sous-titre si le curseur est hors clip.
	 * @returns {void}
	 */
	export function setLastSubtitleEndTime(): void {
		if (globalState.shared.wbwEdit.active) {
			moveManualWordByWordSelectedWordEndToCursor();
			return;
		}

		const subtitleTrack = globalState.getSubtitleTrack;
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const currentClip = subtitleTrack.getCurrentClip(cursorPosition);

		if (currentClip) {
			if (cursorPosition <= currentClip.startTime + 50) return;

			currentClip.setEndTime(cursorPosition);
			subtitleTrack.getClipAfter(currentClip.id)?.setStartTime(cursorPosition + 1);
		} else {
			subtitleTrack.getLastClip()?.setEndTime(cursorPosition);
		}

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Définit le début du sous-titre sous le curseur et recale le sous-titre précédent.
	 * @returns {void}
	 */
	export function setLastSubtitleStartTime(): void {
		if (globalState.shared.wbwEdit.active) {
			moveManualWordByWordSelectedWordStartToCursor();
			return;
		}

		const subtitleTrack = globalState.getSubtitleTrack;
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const currentClip = subtitleTrack.getCurrentClip(cursorPosition);

		if (!currentClip || cursorPosition >= currentClip.endTime - 50) return;

		currentClip.setStartTime(cursorPosition);
		subtitleTrack.getClipBefore(currentClip.id)?.setEndTime(cursorPosition - 1);
		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Supprime le sous-titre en cours d'édition, ou le dernier sous-titre de la timeline.
	 * @returns {void}
	 */
	export function removeLastSubtitle(): void {
		const subtitleTrack = globalState.getSubtitleTrack;
		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;

		if (editedSubtitle) {
			subtitleTrack.removeClip(editedSubtitle.id, true);
			globalState.getSubtitlesEditorState.editSubtitle = null;
		} else {
			subtitleTrack.removeLastClip();
		}

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Ouvre ou ferme l'édition du sous-titre sous le curseur, ou du dernier sous-titre.
	 * @returns {void}
	 */
	export function editCurrentOrLastSubtitle(): void {
		ProjectHistoryManager.track('edit subtitle shortcut', () => {
			const subtitleTrack = globalState.getSubtitleTrack;
			const subtitleClips = subtitleTrack.clips.filter(
				(clip): clip is ClipWithTranslation => clip instanceof ClipWithTranslation
			);
			if (subtitleClips.length === 0) return;

			const clipUnderCursor = subtitleTrack.getCurrentClip(
				globalState.getTimelineState.cursorPosition
			);
			const clip =
				clipUnderCursor instanceof ClipWithTranslation ? clipUnderCursor : subtitleClips.at(-1);
			if (!clip) return;

			globalState.getSubtitlesEditorState.editSubtitle =
				globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id ? null : clip;
		});
	}

	/**
	 * Sélectionne le verset suivant.
	 * @returns {void}
	 */
	export function selectNextVerse(): void {
		goNextVerse();
	}

	/**
	 * Sélectionne le verset précédent.
	 * @returns {Promise<void>}
	 */
	export async function selectPreviousVerse(): Promise<void> {
		await goPreviousVerse();
	}

	/**
	 * Sélectionne le mot suivant dans le verset.
	 * Si on est à la fin du verset, passe au verset suivant.
	 */
	export async function selectNextWord() {
		if (globalState.shared.wbwEdit.active) {
			moveManualWordByWordSelection(1);
			syncVerseSelectionWithManualWordByWordIndex(subtitlesEditorState);
			return;
		}

		if (subtitlesEditorState().endWordIndex < (await selectedVerse())!.words.length - 1) {
			subtitlesEditorState().endWordIndex += 1;
		} else {
			// Passe au verse suivant si on est à la fin du verset
			goNextVerse();
		}
	}

	/**
	 * Sélectionne le mot précédent dans le verset.
	 * Si on est au début du verset, passe au verset précédent.
	 */
	export async function selectPreviousWord() {
		if (globalState.shared.wbwEdit.active) {
			moveManualWordByWordSelection(-1);
			syncVerseSelectionWithManualWordByWordIndex(subtitlesEditorState);
			return;
		}

		if (subtitlesEditorState().endWordIndex > subtitlesEditorState().startWordIndex) {
			subtitlesEditorState().endWordIndex -= 1;
		} else if (subtitlesEditorState().startWordIndex > 0) {
			subtitlesEditorState().startWordIndex -= 1;
			subtitlesEditorState().endWordIndex -= 1;
		} else {
			// Passe au verse précédent si on est au début du verset
			await goPreviousVerse();
		}
	}

	let isAddingSubtitle = false;

	/**
	 * Ajoute une sous-titre avec les mots sélectionnés.
	 */
	export async function addSubtitle() {
		if (globalState.shared.wbwEdit.active) {
			stampManualWordByWordCurrentWordAtCursor();
			return;
		}

		if (isAddingSubtitle) return;
		isAddingSubtitle = true;

		try {
			// Ajoute une sous-titre avec les mots sélectionnés
			const verse = await selectedVerse();
			if (!verse) return;

			const subtitleTrack = globalState.getSubtitleTrack;

			if (subtitlesEditorState().editSubtitle) {
				const currentEdited = subtitlesEditorState().editSubtitle;
				await subtitleTrack.editSubtitle(
					currentEdited,
					verse,
					subtitlesEditorState().startWordIndex,
					subtitlesEditorState().endWordIndex,
					subtitlesEditorState().selectedSurah
				);

				// Si on était en train de diviser un sous-titre, on passe au suivant
				const didAdvance = advanceSplitEditIfNeeded(currentEdited?.id ?? null);
				if (!didAdvance) {
					globalState.getSubtitlesEditorState.editSubtitle = null; // Reset l'édition après modification
					await selectNextWord();
					subtitlesEditorState().startWordIndex = subtitlesEditorState().endWordIndex;
				}
				return;
			}

			const success = await subtitleTrack.addSubtitle(
				verse,
				subtitlesEditorState().startWordIndex,
				subtitlesEditorState().endWordIndex,
				subtitlesEditorState().selectedSurah
			);

			if (success) {
				await selectNextWord();
				subtitlesEditorState().startWordIndex = subtitlesEditorState().endWordIndex;
				globalState.currentProject!.detail.updateVideoDetailAttributes();
			}
		} finally {
			isAddingSubtitle = false;
		}
	}

	/**
	 * Réinitialise les indices de début et de fin des mots sélectionnés.
	 * Utilisé pour réinitialiser la sélection après un changement de verset
	 */
	function resetFirstAndLastWordIndex() {
		subtitlesEditorState().startWordIndex = 0;
		subtitlesEditorState().endWordIndex = 0;
	}

	/**
	 * Gère le clic sur un mot dans le sélecteur de mots.
	 * Met à jour les indices de début et de fin des mots sélectionnés.
	 * @param wordIndex L'index du mot cliqué.
	 */
	function handleWordClick(wordIndex: number): void {
		if (syncManualWordByWordSelectionFromVerseWord(wordIndex, subtitlesEditorState)) {
			return;
		}

		if (suppressNextWordClick) {
			suppressNextWordClick = false;
			return;
		}

		if (wordIndex < subtitlesEditorState().startWordIndex) {
			subtitlesEditorState().startWordIndex = wordIndex;
			subtitlesEditorState().endWordIndex = wordIndex;
		} else if (wordIndex > subtitlesEditorState().endWordIndex) {
			subtitlesEditorState().endWordIndex = wordIndex;
		} else if (wordIndex === subtitlesEditorState().endWordIndex) {
			subtitlesEditorState().startWordIndex = wordIndex;
			subtitlesEditorState().endWordIndex = wordIndex;
		} else {
			subtitlesEditorState().endWordIndex = wordIndex;
		}
	}
	function handleWordMouseDown(wordIndex: number, event: MouseEvent): void {
		if (globalState.shared.wbwEdit.active) {
			void wordIndex;
			void event;
			return;
		}

		if (event.button !== 0) return;
		event.preventDefault();
		isWordDragging = true;
		didWordDrag = false;
		dragStartWordIndex = wordIndex;
	}

	function handleWordMouseEnter(wordIndex: number): void {
		if (globalState.shared.wbwEdit.active) {
			void wordIndex;
			return;
		}

		if (!isWordDragging) return;

		didWordDrag = true;
		subtitlesEditorState().startWordIndex = Math.min(dragStartWordIndex, wordIndex);
		subtitlesEditorState().endWordIndex = Math.max(dragStartWordIndex, wordIndex);
	}

	function stopWordDrag(): void {
		if (globalState.shared.wbwEdit.active) return;

		if (!isWordDragging) return;

		if (didWordDrag) {
			suppressNextWordClick = true;
			// Ne bloque que le clic natif déclenché juste après le drag.
			setTimeout(() => {
				suppressNextWordClick = false;
			}, 0);
		}

		isWordDragging = false;
		didWordDrag = false;
		dragStartWordIndex = -1;
	}

	function handleGlobalWordMouseUp(): void {
		stopWordDrag();
	}

	/**
	 * Vérifie si le mot visé peut déclencher un split automatique.
	 *
	 * @param {number} wordIndex Index 0-based du mot cliqué.
	 * @returns {boolean} True si l'action est disponible.
	 */
	function canShowAutomaticSplitForWord(wordIndex: number): boolean {
		const editSubtitle = subtitlesEditorState().editSubtitle;
		if (!(editSubtitle instanceof SubtitleClip)) return false;
		if (!editSubtitle.alignmentMetadata) return false;
		if (wordIndex < editSubtitle.startWordIndex || wordIndex >= editSubtitle.endWordIndex)
			return false;
		return (
			wordIndex >= subtitlesEditorState().startWordIndex &&
			wordIndex <= subtitlesEditorState().endWordIndex
		);
	}

	/**
	 * Ouvre le menu contextuel du mot si le split automatique est permis.
	 *
	 * @param {number} wordIndex Index 0-based du mot cliqué.
	 * @param {MouseEvent} event Événement natif de clic droit.
	 */
	function handleWordContextMenu(wordIndex: number, event: MouseEvent): void {
		event.preventDefault();

		if (!canShowAutomaticSplitForWord(wordIndex)) {
			const editSubtitle = subtitlesEditorState().editSubtitle;
			if (
				editSubtitle instanceof SubtitleClip &&
				editSubtitle.alignmentMetadata &&
				editSubtitle.alignmentMetadata.words.length === 0
			) {
				console.warn(
					'[WordsSelector] Automatic split is unavailable because MFA word timestamps were not loaded for this clip.',
					{
						clipId: editSubtitle.id,
						surah: editSubtitle.surah,
						verse: editSubtitle.verse,
						wordIndex
					}
				);
			}
			contextMenuWordIndex = null;
			return;
		}

		contextMenuWordIndex = wordIndex;
		void showContextMenuInViewport(wordContextMenu, event);
	}

	/**
	 * Lance le split automatique sur le mot actuellement visé par le menu contextuel.
	 */
	async function handleAutomaticSplitFromContextMenu(): Promise<void> {
		const wordIndex = contextMenuWordIndex;
		const editSubtitle = subtitlesEditorState().editSubtitle;
		const segmentationContext = globalState.getSubtitlesEditorState.segmentationContext;
		contextMenuWordIndex = null;
		currentMenu.set(null);
		await tick();

		if (wordIndex === null || !(editSubtitle instanceof SubtitleClip)) return;
		if (
			!segmentationContext.includeWbwTimestamps &&
			(editSubtitle.alignmentMetadata?.words.length ?? 0) === 0
		) {
			toast.error(get(LL).editor.noWbwTimestampsError());
			return;
		}

		await toast.promise(
			(async () => {
				const didSplit = await automaticSplitSubtitleAtWord(editSubtitle, wordIndex);
				if (!didSplit) {
					throw new Error('Automatic split failed for this word.');
				}
				globalState.getSubtitlesEditorState.editSubtitle = null;
				globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
			})(),
			{
				loading: get(LL).editor.calculatingSplitPoint(),
				success: get(LL).editor.subtitleSplitApplied(),
				error: get(LL).editor.unableToSplitSubtitle()
			}
		);
	}

	$effect(() => {
		ensureManualWordByWordEditStateIsValid();
	});

	$effect(() => {
		const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		untrack(() => {
			if (editSubtitle && editSubtitle instanceof SubtitleClip) {
				// Met l'éditeur de sous-titres à la position du verset à éditer
				if (globalState.shared.wbwEdit.active) return;
				subtitlesEditorState().selectedSurah = editSubtitle.surah;
				subtitlesEditorState().selectedVerse = editSubtitle.verse;
				subtitlesEditorState().startWordIndex = editSubtitle.startWordIndex;
				subtitlesEditorState().endWordIndex = editSubtitle.endWordIndex;
			}
		});
	});
</script>

<section
	class={'w-full h-full overflow-y-auto bg-secondary border duration-100 rounded-lg ' +
		(subtitlesEditorState().editSubtitle ? 'border-yellow-500' : ' border-color')}
>
	<div
		class="min-h-full flex flex-row-reverse flex-wrap justify-start content-center xl:leading-[4.5rem] lg:leading-[3rem] leading-[2.5rem]
	           px-6 text-[2rem] xl:text-5xl arabic py-4"
		onmouseleave={stopWordDrag}
	>
		{#await selectedVerse() then verse}
			{#if verse}
				{#each verse.words as word, index (`${index}-${word.arabic}`)}
					{@const isSelected =
						index >= subtitlesEditorState().startWordIndex &&
						index <= subtitlesEditorState().endWordIndex}
					{@const isFirstSelected = isSelected && index === subtitlesEditorState().startWordIndex}
					{@const isLastSelected = isSelected && index === subtitlesEditorState().endWordIndex}
					{@const isSingleSelected =
						isSelected &&
						subtitlesEditorState().startWordIndex === subtitlesEditorState().endWordIndex}

					<button
						class="word-button flex h-fit flex-col outline-none text-center px-3 cursor-pointer
					       transition-all border-2 duration-200 border-transparent py-1.5 -mx-0.5 select-none
					       {isSelected
							? `word-selected text-[var(--text-on-selected-word)]  ${
									isSingleSelected
										? 'word-first-selected word-last-selected'
										: isLastSelected
											? 'word-first-selected'
											: isFirstSelected
												? 'word-last-selected'
												: 'word-middle-selected'
								}`
							: 'word-not-selected text-primary hover:bg-accent hover:border-color rounded-lg'}"
						onmousedown={(event) => handleWordMouseDown(index, event)}
						onmouseenter={() => handleWordMouseEnter(index)}
						onclick={() => handleWordClick(index)}
						oncontextmenu={(event) => handleWordContextMenu(index, event)}
						ondragstart={(event) => event.preventDefault()}
					>
						<p class="text-center w-full font-medium leading-[1.65]">{word.arabic}</p>
						{#if subtitlesEditorState().showWordTranslation}
							<p class="xl:text-sm text-[10px] text-thirdly font-normal leading-none opacity-80">
								{word.translation}
							</p>
						{/if}
						{#if subtitlesEditorState().showWordTransliteration}
							<p
								class="xl:text-sm text-[10px] text-thirdly font-normal leading-none opacity-70 italic"
							>
								{word.transliteration}
							</p>
						{/if}
					</button>
				{/each}
			{/if}
		{:catch error}
			<div class="w-full flex items-center justify-center p-8">
				<div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
					<span class="material-icons text-red-400">error</span>
					<p class="text-red-400 text-sm">
						{get(LL).editor.errorLoadingVerse({ error: error.message })}
					</p>
				</div>
			</div>
		{/await}
	</div>
</section>

<ContextMenu bind:this={wordContextMenu}>
	{#if contextMenuWordIndex !== null}
		<Item on:click={handleAutomaticSplitFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">call_split</span
				>{$LL.editor.splitAutomaticallyAtWord()}
			</div></Item
		>
	{/if}
</ContextMenu>

<style>
	.word-selected {
		background-color: var(--selected-word-bg);
		border-top: 2px solid var(--accent-primary);
		border-bottom: 2px solid var(--accent-primary);
	}

	.word-first-selected {
		border-left: 2px solid var(--accent-primary);
		border-radius: 12px 0 0 12px;
	}

	.word-last-selected {
		border-right: 2px solid var(--accent-primary);
		border-radius: 0 12px 12px 0;
	}

	.word-middle-selected {
		border-radius: 0;
		border-left: 2px solid transparent;
		border-right: 2px solid transparent;
	}

	/* Si un seul mot est sélectionné, il doit avoir des bords arrondis partout */
	.word-first-selected.word-last-selected {
		border-radius: 12px;
		border: 2px solid var(--accent-primary);
	}

	.word-selected:hover {
		background: var(--bg-accent);
		z-index: 10;
		position: relative;
	}

	.word-not-selected:hover {
		background-color: var(--bg-accent);
		border-color: var(--border-color);
	}
</style>
