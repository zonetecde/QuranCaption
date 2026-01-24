<script lang="ts">
	import { SubtitleClip, TrackType } from '$lib/classes';
	import { ClipWithTranslation } from '$lib/classes/Clip.svelte';
	import type { PredefinedSubtitleClip, PredefinedSubtitleType } from '$lib/classes/Clip.svelte';
	import { Quran, type Verse, type Word } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import ShortcutService from '$lib/services/ShortcutService';
	import { onDestroy, onMount, untrack } from 'svelte';
	import toast from 'svelte-5-french-toast';

	let subtitlesEditorState = $derived(() => globalState.getSubtitlesEditorState);

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

	// Identifiants des raccourcis enregistrés
	// No longer used for manual storage, but kept if needed for other logic (none here)
	// We can use a local variable inside effect

	$effect(() => {
		if (!globalState.settings) return;

		const ids = {
			SELECT_NEXT_WORD: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.SELECT_NEXT_WORD,
				onKeyDown: selectNextWord
			}),

			SELECT_PREVIOUS_WORD: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.SELECT_PREVIOUS_WORD,
				onKeyDown: selectPreviousWord
			}),

			RESET_START_CURSOR: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.RESET_START_CURSOR,
				onKeyDown: () => {
					subtitlesEditorState().startWordIndex = subtitlesEditorState().endWordIndex;
				}
			}),

			SELECT_ALL_WORDS: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.SELECT_ALL_WORDS,
				onKeyDown: async () => {
					subtitlesEditorState().startWordIndex = 0;
					subtitlesEditorState().endWordIndex = (await selectedVerse())!.words.length - 1;
				}
			}),

			SET_END_TO_LAST: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_LAST,
				onKeyDown: async () => {
					subtitlesEditorState().endWordIndex = (await selectedVerse())!.getNextPunctuationMarkIndex(
						subtitlesEditorState().endWordIndex
					);
				}
			}),

			SET_END_TO_PREVIOUS: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS,
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
			}),

			ADD_SUBTITLE: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_SUBTITLE,
				onKeyDown: addSubtitle
			}),

			REMOVE_LAST_SUBTITLE: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE,
				onKeyDown: removeLastSubtitle
			}),

			EDIT_LAST_SUBTITLE: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE,
				onKeyDown: editCurrentOrLastSubtitle
			}),

			ADD_SILENCE: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE,
				onKeyDown: addSilence
			}),

			ADD_BASMALA: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_BASMALA,
				onKeyDown: () => addPredefinedSubtitle('Basmala')
			}),

			ADD_ISTIADHAH: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_ISTIADHAH,
				onKeyDown: () => addPredefinedSubtitle('Istiadhah')
			}),

			ADD_CUSTOM_TEXT_CLIP: ShortcutService.registerShortcut({
				key: globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP,
				onKeyDown: () => addCustomTextClip()
			}),

			ESCAPE: ShortcutService.registerShortcut({
				key: { keys: ['Escape'], description: 'Exit subtitle editing' },
				onKeyDown: () => (globalState.getSubtitlesEditorState.editSubtitle = null)
			})
		};

		return () => {
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_NEXT_WORD,
				ids.SELECT_NEXT_WORD
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_PREVIOUS_WORD,
				ids.SELECT_PREVIOUS_WORD
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.RESET_START_CURSOR,
				ids.RESET_START_CURSOR
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_ALL_WORDS,
				ids.SELECT_ALL_WORDS
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_END_TO_LAST,
				ids.SET_END_TO_LAST
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS,
				ids.SET_END_TO_PREVIOUS
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SUBTITLE,
				ids.ADD_SUBTITLE
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE,
				ids.REMOVE_LAST_SUBTITLE
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE,
				ids.EDIT_LAST_SUBTITLE
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE,
				ids.ADD_SILENCE
			);

			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_BASMALA,
				ids.ADD_BASMALA
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_ISTIADHAH,
				ids.ADD_ISTIADHAH
			);
			ShortcutService.unregisterShortcut(
				globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP,
				ids.ADD_CUSTOM_TEXT_CLIP
			);
			ShortcutService.unregisterShortcut(
				{ keys: ['Escape'], description: 'Exit subtitle editing' },
				ids.ESCAPE
			);
		};
	});

	onMount(() => {
		// No manual shortcuts here
	});

	onDestroy(() => {
		// Clean up handled by effect
	});

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
		if (clip instanceof ClipWithTranslation) {
			clip.markAsManualEdit();
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
				await subtitleTrack.editSubtitle(
					subtitlesEditorState().editSubtitle as any,
					verse,
					subtitlesEditorState().startWordIndex,
					subtitlesEditorState().endWordIndex,
					subtitlesEditorState().selectedSurah
				);

				globalState.getSubtitlesEditorState.editSubtitle = null; // Reset l'édition après modification
				toast.success('Subtitle updated successfully!');
				await selectNextWord();
				subtitlesEditorState().startWordIndex = subtitlesEditorState().endWordIndex;
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
	function handleWordClick(wordIndex: number): any {
		if (wordIndex < subtitlesEditorState().startWordIndex) {
			subtitlesEditorState().startWordIndex = wordIndex;
			subtitlesEditorState().endWordIndex = wordIndex;
		} else if (wordIndex > subtitlesEditorState().endWordIndex) {
			subtitlesEditorState().endWordIndex = wordIndex;
		} else {
			// Si le mot est déjà sélectionné, on le désélectionne
			if (
				wordIndex >= subtitlesEditorState().startWordIndex &&
				wordIndex <= subtitlesEditorState().endWordIndex
			) {
				subtitlesEditorState().startWordIndex = wordIndex;
				subtitlesEditorState().endWordIndex = wordIndex;
			}
		}
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
		globalState.getVideoStyle.addCustomClip(
			'text',
			globalState.getSubtitleTrack.getLastClip()?.endTime ?? 0,
			globalState.getTimelineState.cursorPosition
		);
	}
</script>

<section
	class={'w-full h-full overflow-y-auto bg-secondary border duration-100 rounded-lg ' +
		(subtitlesEditorState().editSubtitle ? 'border-yellow-500' : ' border-color')}
>
	<div
		class="min-h-full flex flex-row-reverse flex-wrap justify-start content-center xl:leading-[4.5rem] lg:leading-[3rem] leading-[2.5rem]
	           px-6 text-4xl xl:text-5xl arabic py-4"
	>
		{#await selectedVerse() then verse}
			{#if verse}
				{#each verse.words as word, index}
					{@const isSelected =
						index >= subtitlesEditorState().startWordIndex &&
						index <= subtitlesEditorState().endWordIndex}
					{@const isFirstSelected = isSelected && index === subtitlesEditorState().startWordIndex}
					{@const isLastSelected = isSelected && index === subtitlesEditorState().endWordIndex}
					{@const isSingleSelected =
						isSelected &&
						subtitlesEditorState().startWordIndex === subtitlesEditorState().endWordIndex}
					{@const isMiddleSelected = isSelected && !isFirstSelected && !isLastSelected}

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
						onclick={() => handleWordClick(index)}
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
