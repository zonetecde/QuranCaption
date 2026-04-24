<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import {
		ClipWithTranslation,
		type PredefinedSubtitleClip,
		type PredefinedSubtitleType
	} from '$lib/classes/Clip.svelte';
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { automaticSplitSubtitleAtWord } from '$lib/services/AutoSegmentation';
	import ShortcutService from '$lib/services/ShortcutService';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
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
		// Set up les shortcuts pour sélectionner les mots
		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_NEXT_WORD,
			onKeyDown: selectNextWord
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_PREVIOUS_WORD,
			onKeyDown: selectPreviousWord
		});

		// Set up les shortcuts divers
		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.RESET_START_CURSOR,
			onKeyDown: () => {
				subtitlesEditorState().startWordIndex = subtitlesEditorState().endWordIndex;
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_ALL_WORDS,
			onKeyDown: async () => {
				subtitlesEditorState().startWordIndex = 0;
				subtitlesEditorState().endWordIndex = (await selectedVerse())!.words.length - 1;
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_END_TO_LAST,
			onKeyDown: async () => {
				subtitlesEditorState().endWordIndex = (await selectedVerse())!.getNextPunctuationMarkIndex(
					subtitlesEditorState().endWordIndex
				);
			}
		});
		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS,
			onKeyDown: async () => {
				const verse = await selectedVerse();
				if (!verse) return; // Sans verset actif, on ne peut pas chercher de ponctuation

				const previousEndIndex = verse.getPreviousPunctuationMarkIndex(
					subtitlesEditorState().endWordIndex
				);

				if (previousEndIndex === subtitlesEditorState().endWordIndex) {
					return; // Déjà sur un signe d'arrêt, on ne bouge pas
				}

				subtitlesEditorState().endWordIndex = previousEndIndex;
				if (subtitlesEditorState().startWordIndex > subtitlesEditorState().endWordIndex) {
					// Garde une sélection valide en ramenant le début sur la fin
					subtitlesEditorState().startWordIndex = subtitlesEditorState().endWordIndex;
				}
			}
		});

		// Set up les shortcuts d'action
		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SUBTITLE,
			onKeyDown: addSubtitle
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE,
			onKeyDown: removeLastSubtitle
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE,
			onKeyDown: editCurrentOrLastSubtitle
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE,
			onKeyDown: addSilence
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_BASMALA,
			onKeyDown: () => addPredefinedSubtitle('Basmala')
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_ISTIADHAH,
			onKeyDown: () => addPredefinedSubtitle("Isti'adha")
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_AMIN,
			onKeyDown: () => addPredefinedSubtitle('Amin')
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_TAKBIR,
			onKeyDown: () => addPredefinedSubtitle('Takbir')
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_TAHMEED,
			onKeyDown: () => addPredefinedSubtitle('Tahmeed')
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_TASLEEM,
			onKeyDown: () => addPredefinedSubtitle('Tasleem')
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_SADAQA,
			onKeyDown: () => addPredefinedSubtitle('Sadaqa')
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP,
			onKeyDown: () => addCustomTextClip()
		});

		ShortcutService.registerShortcut({
			key: { keys: ['Escape'], description: 'Exit subtitle editing' },
			onKeyDown: () => {
				globalState.getSubtitlesEditorState.editSubtitle = null;
				globalState.getSubtitlesEditorState.pendingSplitEditNextId = null;
			}
		});

		document.addEventListener('mouseup', handleGlobalWordMouseUp);
	});

	onDestroy(() => {
		// Clean up les shortcuts
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_NEXT_WORD
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_PREVIOUS_WORD
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.RESET_START_CURSOR
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_ALL_WORDS
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_END_TO_LAST
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SUBTITLE
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE
		);

		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_BASMALA
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_ISTIADHAH
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_AMIN
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_TAKBIR
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_TAHMEED
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_TASLEEM
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.PREDEFINED_SUBTITLES.ADD_SADAQA
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP
		);
		ShortcutService.unregisterShortcut({ keys: ['Escape'], description: 'Exit subtitle editing' });

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

	function editCurrentOrLastSubtitle(): void {
		const subtitleTrack = globalState.getSubtitleTrack;
		if (subtitleTrack.clips.length <= 0) return;

		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const clipUnderCursor = subtitleTrack.getCurrentClip(cursorPosition);

		let clip: SubtitleClip | PredefinedSubtitleClip | null = null;
		if (clipUnderCursor) {
			clip = clipUnderCursor as SubtitleClip | PredefinedSubtitleClip;
		} else {
			clip = subtitleTrack.getLastClip() as SubtitleClip | PredefinedSubtitleClip | null;
		}

		if (!clip) return;

		// Modifie le sous-titre
		if (globalState.getSubtitlesEditorState.editSubtitle?.id === clip.id) {
			// Si on est déjà en train de modifier ce sous-titre, on le quitte
			globalState.getSubtitlesEditorState.editSubtitle = null;
			return;
		}
		globalState.getSubtitlesEditorState.editSubtitle = clip;
	}

	/**
	 * Sélectionne le mot suivant dans le verset.
	 * Si on est à la fin du verset, passe au verset suivant.
	 */
	async function selectNextWord() {
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
	async function selectPreviousWord() {
		if (subtitlesEditorState().endWordIndex > subtitlesEditorState().startWordIndex) {
			subtitlesEditorState().endWordIndex -= 1;
		} else if (subtitlesEditorState().startWordIndex > 0) {
			subtitlesEditorState().startWordIndex -= 1;
			subtitlesEditorState().endWordIndex -= 1;
		} else {
			// Passe au verse précédent si on est au début du verset
			goPreviousVerse();
		}
	}

	let isAddingSubtitle = false;

	/**
	 * Ajoute une sous-titre avec les mots sélectionnés.
	 */
	async function addSubtitle() {
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
				toast.success('Subtitle updated successfully!');
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
	 * Ajoute un silence à la timeline (shortcut ADD_SILENCE).
	 * Utilisé pour ajouter un espace vide entre les sous-titres.
	 */
	function addSilence(): void {
		const subtitleTrack = globalState.getSubtitleTrack;

		const success = subtitleTrack.addSilence();
		if (success) globalState.currentProject!.detail.updateVideoDetailAttributes();
	}

	function addPredefinedSubtitle(type: PredefinedSubtitleType) {
		const subtitleTrack = globalState.getSubtitleTrack;

		const success = subtitleTrack.addPredefinedSubtitle(type);
		if (success) globalState.currentProject!.detail.updateVideoDetailAttributes();
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
	 * Supprime le dernier sous-titre de la timeline (shortcut REMOVE_LAST_SUBTITLE).
	 */
	function removeLastSubtitle(): void {
		const subtitleTrack = globalState.getSubtitleTrack;

		// Si un sous-titre est en cours d'édition, on le supprime explicitement plutôt que le dernier ajouté
		const editedSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (editedSubtitle) {
			subtitleTrack.removeClip(editedSubtitle.id, true);
			globalState.getSubtitlesEditorState.editSubtitle = null;
			globalState.currentProject!.detail.updateVideoDetailAttributes();
			globalState.updateVideoPreviewUI();
			return;
		}

		subtitleTrack.removeLastClip();

		globalState.currentProject!.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Gère le clic sur un mot dans le sélecteur de mots.
	 * Met à jour les indices de début et de fin des mots sélectionnés.
	 * @param wordIndex L'index du mot cliqué.
	 */
	function handleWordClick(wordIndex: number): void {
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
		if (event.button !== 0) return;
		event.preventDefault();
		isWordDragging = true;
		didWordDrag = false;
		dragStartWordIndex = wordIndex;
	}

	function handleWordMouseEnter(wordIndex: number): void {
		if (!isWordDragging) return;

		didWordDrag = true;
		subtitlesEditorState().startWordIndex = Math.min(dragStartWordIndex, wordIndex);
		subtitlesEditorState().endWordIndex = Math.max(dragStartWordIndex, wordIndex);
	}

	function stopWordDrag(): void {
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
		if (wordIndex < editSubtitle.startWordIndex || wordIndex >= editSubtitle.endWordIndex) return false;
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

		event.preventDefault();
		contextMenuWordIndex = wordIndex;
		wordContextMenu?.show(event);
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
			toast.error(
				'This subtitle was generated without word-by-word timestamps. Enable "Include word-by-word timestamps" in Segmentation settings, then run the segmentation again.'
			);
			return;
		}

		await toast.promise(
			(async () => {
				const didSplit = await automaticSplitSubtitleAtWord(editSubtitle, wordIndex);
				if (!didSplit) {
					throw new Error('Automatic split failed for this word.');
				}
			})(),
			{
				loading: 'Calculating the split point...',
				success: 'Subtitle split applied.',
				error: 'Unable to split this subtitle automatically.'
			}
		);
	}

	$effect(() => {
		const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		untrack(() => {
			if (editSubtitle && editSubtitle instanceof SubtitleClip) {
				// Met l'éditeur de sous-titres à la position du verset à éditer
				subtitlesEditorState().selectedSurah = editSubtitle.surah;
				subtitlesEditorState().selectedVerse = editSubtitle.verse;
				subtitlesEditorState().startWordIndex = editSubtitle.startWordIndex;
				subtitlesEditorState().endWordIndex = editSubtitle.endWordIndex;
			}
		});
	});

	/**
	 * Ajoute un custom text clip à la timeline entre le dernier sous-titre et la position actuelle du curseur.
	 */
	function addCustomTextClip(): void {
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const lastSubtitleEndTime = globalState.getSubtitleTrack.getLastClip()?.endTime;
		const threeSecondsInMs = 3000;

		let startTime = lastSubtitleEndTime ?? Math.max(0, cursorPosition - threeSecondsInMs);
		let endTime = cursorPosition;

		// Si le dernier sous-titre finit après le curseur, on crée un clip de 3s qui se termine au curseur.
		if (lastSubtitleEndTime !== undefined && lastSubtitleEndTime > cursorPosition) {
			startTime = Math.max(0, cursorPosition - threeSecondsInMs);
		}

		// Sécurise une plage valide même sur les cas limites (ex: curseur à la fin exacte du dernier sous-titre).
		if (endTime <= startTime) {
			endTime = startTime + threeSecondsInMs;
		}

		globalState.getVideoStyle.addCustomClip('text', startTime, endTime);
	}
</script>

<section
	class={'w-full h-full overflow-y-auto bg-secondary border duration-100 rounded-lg ' +
		(subtitlesEditorState().editSubtitle ? 'border-yellow-500' : ' border-color')}
>
	<div
		class="min-h-full flex flex-row-reverse flex-wrap justify-start content-center xl:leading-[4.5rem] lg:leading-[3rem] leading-[2.5rem]
	           px-6 text-4xl xl:text-5xl arabic py-4"
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
					       transition-all border-2 duration-200 border-transparent py-3 -mx-0.5 select-none
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
						<p class="text-center w-full font-medium">{word.arabic}</p>
						{#if subtitlesEditorState().showWordTranslation}
							<p class="xl:text-sm text-xs text-thirdly mt-1 font-normal opacity-80">
								{word.translation}
							</p>
						{/if}
						{#if subtitlesEditorState().showWordTransliteration}
							<p class="xl:text-sm text-xs text-thirdly mt-0.5 font-normal opacity-70 italic">
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
					<p class="text-red-400 text-sm">Error loading verse: {error.message}</p>
				</div>
			</div>
		{/await}
	</div>
</section>

<ContextMenu bind:this={wordContextMenu}>
	{#if contextMenuWordIndex !== null}
		<Item on:click={handleAutomaticSplitFromContextMenu}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">call_split</span>Split automatically
				at this word
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
