<script lang="ts">
	import { SubtitleClip, type Edition } from '$lib/classes';
	import {
		getInlineStyleCss,
		getInlineStyleFlagsForWordIndex,
		getTranslationTrimUnitCount,
		getTranslationTrimUnits,
		sliceTranslationTrimUnits,
		tokenizeTranslationText,
		type TranslationInlineStyleFlags,
		type TranslationInlineTextSegment,
		VerseTranslation
	} from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import AiTranslationTelemetryService from '$lib/services/AiTranslationTelemetryService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { WbwTranslationService } from '$lib/services/WbwTranslationService';
	import { onDestroy, onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	let {
		edition,
		subtitle = $bindable<SubtitleClip>(),
		previousSubtitle
	}: {
		edition: Edition;
		subtitle: SubtitleClip;
		previousSubtitle?: SubtitleClip;
	} = $props();

	let translation = $derived(() => {
		return subtitle.getTranslation(edition) as VerseTranslation;
	});

	let translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);
	let isInlineStyleMode = $derived(() => translationsEditorState().isInlineStyleMode);
	let isTranslationWbwMappingMode = $derived(
		() => translationsEditorState().isTranslationWbwMappingMode
	);
	const translationMetadata = $derived(() => globalState.getTranslationMetadata(edition.language));

	// Variables pour gérer le glisser-déposer
	let isDragging = $state(false);
	let dragStartIndex = $state(-1);

	let isInlineDragging = $state(false);
	let inlineDragStartIndex = $state(-1);
	let inlineSelectionStart = $state(-1);
	let inlineSelectionEnd = $state(-1);

	let originalTranslation: string = $state('');
	let originalTranslationUnits = $derived(() => getTranslationTrimUnits(originalTranslation));
	let originalTranslationUnitCount = $derived(() =>
		getTranslationTrimUnitCount(originalTranslation)
	);
	let translationInput: HTMLInputElement | null = $state(null);
	let editableTranslationValue: string = $state('');

	let previousSubtitleTranslationStartIndex: number = $state(-1);
	let previousSubtitleTranslationEndIndex: number = $state(-1);
	let manualReviewTimeoutId: ReturnType<typeof setTimeout> | undefined = undefined;
	let lastClickedWordIndex = $state(-1);
	let isTrimHistoryTransaction = false;
	let isTextHistoryTransaction = false;
	let wasWbwMappingMode = false;

	onMount(() => {
		if (translation().type === 'verse') {
			originalTranslation = globalState.getProjectTranslation.getVerseTranslation(
				edition,
				subtitle.getVerseKey()
			);
		}
	});

	onDestroy(() => {
		if (manualReviewTimeoutId) {
			clearTimeout(manualReviewTimeoutId);
			manualReviewTimeoutId = undefined;
		}
		if (isTrimHistoryTransaction || isTextHistoryTransaction) {
			ProjectHistoryManager.cancel();
			isTrimHistoryTransaction = false;
			isTextHistoryTransaction = false;
		}
		void flushManualReviewTelemetry();
	});

	$effect(() => {
		// Si le sous-titre d'avant est la continuité du verset:
		if (
			translation().type === 'verse' &&
			previousSubtitle &&
			previousSubtitle.type === 'Subtitle' &&
			previousSubtitle.verse === subtitle.verse &&
			previousSubtitle.surah === subtitle.surah
		) {
			const previousSubtitleTranslation = previousSubtitle.getTranslation(
				edition
			) as VerseTranslation;
			// Alors on highlight toute la traduction du sous-titre précédent
			const isTranslationLocked =
				translation().isStatusComplete() && translation().status !== 'automatically trimmed';

			// Met à jour les indices de début et de fin de la traduction du sous-titre précédent
			if (
				!(
					previousSubtitleTranslation.startWordIndex === 0 &&
					previousSubtitleTranslation.endWordIndex === originalTranslationUnitCount() - 1 &&
					!previousSubtitleTranslation.isBruteForce
				)
			) {
				previousSubtitleTranslationStartIndex = previousSubtitleTranslation.startWordIndex;
				previousSubtitleTranslationEndIndex = previousSubtitleTranslation.endWordIndex;
			}

			// Si c'est la continuité du verset précédent, on met à jour la traduction
			if (
				previousSubtitle.endWordIndex + 1 === subtitle.startWordIndex && // Vérifie que le sous-titre précédent se termine juste avant le début du sous-titre actuel
				previousSubtitleTranslation.status === 'reviewed' && // vérifie que la traduction du sous-titre précédent n'est pas vide
				!previousSubtitleTranslation.isBruteForce // vérifie que la traduction du sous-titre précédent a été trimmed via l'outil
			) {
				// Commence la sélection de la traduction du verset actuel à celle de fin de la traduction du sous-titre précédent
				if (!isTranslationLocked) {
					translation().startWordIndex = previousSubtitleTranslationEndIndex + 1;
					if (translation().startWordIndex > translation().endWordIndex) {
						translation().endWordIndex = originalTranslationUnitCount() - 1;
					}
					updateTranslationText();

					// Si c'est les derniers mots du verset, normalement le trim est fait automatiquement
					// donc on met le status à 'automatically trimmed'
					// sinon on le met à 'to review' car il faut encore trim la fin de la traduction
					if (subtitle.isLastWordsOfVerse) {
						translation().updateStatus('automatically trimmed', edition);
					} else {
						translation().updateStatus('to review', edition);
					}
				}
			} else if (
				previousSubtitleTranslation.status === 'reviewed' &&
				subtitle.startWordIndex === previousSubtitle.startWordIndex &&
				subtitle.endWordIndex === previousSubtitle.endWordIndex &&
				!isTranslationLocked
			) {
				// Si c'est exactement la même sélection que le sous-titre précédent, alors on applique la même traduction que lui
				translation().startWordIndex = previousSubtitleTranslation.startWordIndex;
				translation().endWordIndex = previousSubtitleTranslation.endWordIndex;
				translation().isBruteForce = previousSubtitleTranslation.isBruteForce;
				translation().text = previousSubtitleTranslation.text;
				translation().copyInlineStylesFrom(previousSubtitleTranslation);
				translation().updateStatus('reviewed', edition);
			}
		}
	});

	type TranslationWordItem = {
		text: string;
		wordIndex: number;
		flags: TranslationInlineStyleFlags;
	};

	let arabicWordCount = $derived(
		() => subtitle.getArabicRenderParts().text.split(' ').filter(Boolean).length
	);
	let arabicWords = $derived(() => subtitle.getArabicRenderParts().text.split(' ').filter(Boolean));
	let wbwTranslationWords = $state<string[]>([]);
	let wbwTranslationRequestId = 0;
	let wbwTranslationDirection = $derived(() =>
		WbwTranslationService.getLanguageDirection(
			globalState.settings?.persistentUiState.wbwTranslationLanguage ?? 'en'
		)
	);

	$effect(() => {
		const language = globalState.settings?.persistentUiState.wbwTranslationLanguage ?? 'en';
		const requestId = ++wbwTranslationRequestId;

		void WbwTranslationService.getWordsForRange(
			language,
			subtitle.surah,
			subtitle.verse,
			subtitle.startWordIndex,
			subtitle.endWordIndex
		)
			.then((translatedWords) => {
				if (requestId === wbwTranslationRequestId) {
					wbwTranslationWords = translatedWords;
				}
			})
			.catch(() => {
				if (requestId === wbwTranslationRequestId) {
					wbwTranslationWords = [];
				}
			});
	});

	/**
	 * Retourne les toggles de style actuellement actifs dans le panneau de droite.
	 */
	function getCurrentInlineStyleFlags(): TranslationInlineStyleFlags {
		return {
			bold: translationsEditorState().inlineStyleBoldEnabled,
			italic: translationsEditorState().inlineStyleItalicEnabled,
			underline: translationsEditorState().inlineStyleUnderlineEnabled,
			color: translationsEditorState().inlineStyleColorEnabled
				? translationsEditorState().inlineStyleColorValue
				: null
		};
	}

	/**
	 * Indique si au moins un style (bold/italic/underline) est actif.
	 */
	function hasActiveInlineStyleFlags(): boolean {
		const flags = getCurrentInlineStyleFlags();
		return flags.bold || flags.italic || flags.underline || Boolean(flags.color);
	}

	/**
	 * Tokenize la traduction trimmee et annote chaque mot avec ses styles inline.
	 */
	function getTrimmedTranslationWords(): TranslationWordItem[] {
		const tokens = tokenizeTranslationText(translation().text);
		return tokens
			.filter((token): token is { text: string; isWord: true; wordIndex: number } =>
				Boolean(token.isWord && token.wordIndex !== null)
			)
			.map((token) => ({
				text: token.text,
				wordIndex: token.wordIndex,
				flags: getInlineStyleFlagsForWordIndex(translation().inlineStyleRuns ?? [], token.wordIndex)
			}));
	}

	/**
	 * Construit la liste de segments texte/styles pour le rendu final de la traduction.
	 */
	function getStyledSegments(): TranslationInlineTextSegment[] {
		return translation().getInlineStyledSegments();
	}

	/**
	 * Réinitialise l'état de sélection de mots utilisé pendant le drag.
	 */
	function resetInlineSelection(): void {
		isInlineDragging = false;
		inlineDragStartIndex = -1;
		inlineSelectionStart = -1;
		inlineSelectionEnd = -1;
	}

	/**
	 * Retourne les ranges WBW valides pour le sous-titre courant.
	 *
	 * @returns {import('$lib/classes/Translation.svelte').TranslationWbwRange[]} Ranges normalisées.
	 */
	function getNormalizedWbwRanges() {
		return translation().getNormalizedWbwRanges(arabicWordCount());
	}

	/**
	 * Retourne la traduction mot à mot affichée pour un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index local du mot arabe.
	 * @returns {string} Traduction WBW ou libellé de secours.
	 */
	function getWbwHelperWordLabel(arabicWordIndex: number): string {
		return (
			wbwTranslationWords[arabicWordIndex] ||
			LL_.editor.translationWbwActiveWord({ index: arabicWordIndex + 1 })
		);
	}

	/**
	 * Retourne les mappings WBW d'un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index local du mot arabe.
	 * @returns {import('$lib/classes/Translation.svelte').TranslationWbwRange[]} Ranges trouvées.
	 */
	function getWbwRangesForArabicWord(arabicWordIndex: number) {
		return getNormalizedWbwRanges().filter((range) => range.arabicWordIndex === arabicWordIndex);
	}

	/**
	 * Indique si une unité de traduction est liée à un mot arabe donné.
	 *
	 * @param {number} arabicWordIndex Index local du mot arabe.
	 * @param {number} unitIndex Index de l'unité trim.
	 * @returns {boolean} `true` si l'unité est mappée.
	 */
	function isWbwUnitMappedToArabicWord(arabicWordIndex: number, unitIndex: number): boolean {
		return getWbwRangesForArabicWord(arabicWordIndex).some(
			(range) => range.startUnitIndex <= unitIndex && unitIndex <= range.endUnitIndex
		);
	}

	/**
	 * Indique si l'unité doit apparaître sélectionnée sur une ligne WBW.
	 *
	 * @param {number} arabicWordIndex Index local du mot arabe.
	 * @param {number} unitIndex Index de l'unité trim.
	 * @returns {boolean} `true` si l'unité est sélectionnée ou déjà mappée.
	 */
	function isWbwUnitSelectedForArabicWord(arabicWordIndex: number, unitIndex: number): boolean {
		return isWbwUnitMappedToArabicWord(arabicWordIndex, unitIndex);
	}

	/**
	 * Retourne le prochain mot arabe non mappé à partir d'un index donné.
	 *
	 * @param {number} fromIndex Index de départ.
	 * @returns {number} Index du prochain mot, ou un index borné si tout est mappé.
	 */
	function getNextUnmappedArabicWordIndex(fromIndex: number): number {
		const mappedIndexes = new Set(getNormalizedWbwRanges().map((range) => range.arabicWordIndex));
		for (let index = fromIndex; index < arabicWordCount(); index++) {
			if (!mappedIndexes.has(index)) return index;
		}
		for (let index = 0; index < Math.min(fromIndex, arabicWordCount()); index++) {
			if (!mappedIndexes.has(index)) return index;
		}
		return Math.max(0, Math.min(arabicWordCount() - 1, fromIndex - 1));
	}

	/**
	 * Bascule une unité de traduction dans le mapping WBW.
	 *
	 * @param {number} arabicWordIndex Index local du mot arabe à mapper.
	 * @param {number} unitIndex Index de l'unité cliquée.
	 * @param {MouseEvent} event Événement souris source.
	 * @returns {void}
	 */
	function toggleWbwMappingUnit(
		arabicWordIndex: number,
		unitIndex: number,
		event: MouseEvent
	): void {
		if (translation().type !== 'verse' || !isTranslationWbwMappingMode()) return;
		event.preventDefault();
		translationsEditorState().translationWbwActiveArabicWordIndex = arabicWordIndex;
		ProjectHistoryManager.track('toggle translation wbw mapping unit', () => {
			translation().toggleWbwUnit(arabicWordIndex, unitIndex);
		});
	}

	/**
	 * Supprime le mapping du mot arabe actif.
	 *
	 * @returns {void}
	 */
	function clearCurrentWbwMapping(arabicWordIndex: number): void {
		ProjectHistoryManager.track('clear translation wbw mapping', () => {
			translation().clearWbwRange(arabicWordIndex);
		});
	}

	/**
	 * Supprime tous les mappings WBW de cette traduction.
	 *
	 * @returns {void}
	 */
	function clearAllWbwMappings(): void {
		ProjectHistoryManager.track('clear all translation wbw mappings', () => {
			translation().clearWbwRanges();
		});
		translationsEditorState().translationWbwActiveArabicWordIndex = 0;
	}

	/**
	 * Applique (toggle) les styles actifs à la sélection courante puis nettoie la sélection.
	 */
	function applyInlineStylesFromSelection(): void {
		if (
			translation().type !== 'verse' ||
			!isInlineStyleMode() ||
			inlineSelectionStart === -1 ||
			inlineSelectionEnd === -1
		) {
			resetInlineSelection();
			return;
		}

		const flags = getCurrentInlineStyleFlags();
		// Rien a appliquer si aucun toggle n'est actif dans le panneau.
		if (!hasActiveInlineStyleFlags()) {
			resetInlineSelection();
			return;
		}

		ProjectHistoryManager.track('style translation words', () => {
			translation().toggleInlineStyles(inlineSelectionStart, inlineSelectionEnd, flags);
		});
		resetInlineSelection();
	}

	/**
	 * Demarre une selection inline a partir d'un mot.
	 */
	function handleInlineMouseDown(wordIndex: number, event: MouseEvent): void {
		if (translation().type !== 'verse' || !isInlineStyleMode()) return;
		event.preventDefault();
		isInlineDragging = true;
		inlineDragStartIndex = wordIndex;
		inlineSelectionStart = wordIndex;
		inlineSelectionEnd = wordIndex;
	}

	/**
	 * Etend la selection inline pendant le drag.
	 */
	function handleInlineMouseEnter(wordIndex: number): void {
		if (!isInlineDragging || translation().type !== 'verse' || !isInlineStyleMode()) return;

		inlineSelectionStart = Math.min(inlineDragStartIndex, wordIndex);
		inlineSelectionEnd = Math.max(inlineDragStartIndex, wordIndex);
	}

	/**
	 * Termine une selection inline et declenche l'application des styles.
	 */
	function handleInlineMouseUp(): void {
		if (!isInlineDragging) return;
		applyInlineStylesFromSelection();
	}

	async function flushManualReviewTelemetry(): Promise<void> {
		if (!globalState.currentProject || translation().type !== 'verse') return;

		await AiTranslationTelemetryService.recordManualReview({
			projectId: globalState.currentProject.detail.id,
			editionKey: edition.key,
			editionName: edition.name,
			subtitleId: subtitle.id,
			verseKey: subtitle.getVerseKey(),
			segment: subtitle.text,
			status: translation().status,
			manualReview: translation().text
		});
	}

	function scheduleManualReviewTelemetry(): void {
		if (manualReviewTimeoutId) clearTimeout(manualReviewTimeoutId);
		manualReviewTimeoutId = setTimeout(() => {
			manualReviewTimeoutId = undefined;
			void flushManualReviewTelemetry();
		}, 400);
	}

	function beginWordSelectionEditing(): void {
		if (
			translation().type !== 'verse' ||
			!translation().isBruteForce ||
			isInlineStyleMode() ||
			isTranslationWbwMappingMode()
		)
			return;
		translation().isBruteForce = false;
	}

	function wordClicked(i: number): void {
		if (translation().type === 'verse' && !isInlineStyleMode() && !isTranslationWbwMappingMode()) {
			beginWordSelectionEditing();
			if (i < translation().startWordIndex) {
				// Si le mot est avant le début de la traduction, on le sélectionne
				translation().startWordIndex = i;
				translation().endWordIndex = i;
			} else if (i > translation().endWordIndex) {
				// Si le mot est après la fin de la traduction, on étend la sélection
				translation().endWordIndex = i;
			} else if (i >= translation().startWordIndex && i <= translation().endWordIndex) {
				// Si le mot est déjà sélectionné, on arrête la traduction à ce mot SI
				// il nécessite review, sinon reset les curseurs sur ce mot
				translation().endWordIndex = i;
				if (lastClickedWordIndex === i) {
					translation().startWordIndex = i;
				}
			}

			lastClickedWordIndex = i;

			updateTranslationText();
			translation().updateStatus('reviewed', edition);
		}
	}

	function updateTranslationText(): void {
		translation().setTextAndClearInlineStyles(
			sliceTranslationTrimUnits(
				originalTranslation,
				translation().startWordIndex,
				translation().endWordIndex
			)
		);
	}

	function handleMouseDown(i: number, event: MouseEvent): void {
		if (translation().type === 'verse' && !isInlineStyleMode() && !isTranslationWbwMappingMode()) {
			beginWordSelectionEditing();
			event.preventDefault();
			ProjectHistoryManager.begin('trim translation');
			isTrimHistoryTransaction = true;
			isDragging = true;
			dragStartIndex = i;
			wordClicked(i);
		}
	}

	function handleMouseEnter(i: number): void {
		if (
			isDragging &&
			translation().type === 'verse' &&
			!isInlineStyleMode() &&
			!isTranslationWbwMappingMode()
		) {
			beginWordSelectionEditing();
			const startIndex = Math.min(dragStartIndex, i);
			const endIndex = Math.max(dragStartIndex, i);
			translation().startWordIndex = startIndex;
			translation().endWordIndex = endIndex;
			updateTranslationText();
		}
	}

	function handleMouseUp(): void {
		const shouldFlush = isDragging;
		isDragging = false;
		dragStartIndex = -1;
		if (shouldFlush) {
			ProjectHistoryManager.commit();
			isTrimHistoryTransaction = false;
			void flushManualReviewTelemetry();
		}
	}

	// Gestionnaire global pour le mouseup
	function handleGlobalMouseUp(): void {
		if (isDragging) {
			handleMouseUp();
		}
		if (isInlineDragging) {
			handleInlineMouseUp();
		}
	}

	/**
	 * Convertis les vrais \\n en \\n pour affichage dans l'input traduction
	 */
	function escapeNewlinesForInput(value: string): string {
		return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\\n');
	}

	/**
	 * Convertit les \\n écrit brute en vrai \\n
	 */
	function normalizeInputToTranslation(value: string): string {
		return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\\n/g, '\n');
	}

	function handleTranslationInput(event: Event): void {
		const rawValue = (event.target as HTMLInputElement).value;
		editableTranslationValue = rawValue;

		const translationValue = normalizeInputToTranslation(rawValue);
		subtitle.translations[edition.name]?.setTextAndClearInlineStyles(translationValue);
		scheduleManualReviewTelemetry();
	}

	/**
	 * Demarre une transaction pour grouper l'edition texte de traduction.
	 * @returns {void}
	 */
	function handleTranslationInputFocus(): void {
		ProjectHistoryManager.begin('edit translation text');
		isTextHistoryTransaction = true;
	}

	/**
	 * Termine la transaction d'edition texte et envoie la telemetrie.
	 * @returns {void}
	 */
	function handleTranslationInputBlur(): void {
		if (isTextHistoryTransaction) {
			ProjectHistoryManager.commit();
			isTextHistoryTransaction = false;
		}
		void flushManualReviewTelemetry();
	}

	$effect(() => {
		const sourceValue = String(subtitle.translations[edition.name]?.text ?? '');
		const escapedValue = escapeNewlinesForInput(sourceValue);
		if (editableTranslationValue !== escapedValue) {
			editableTranslationValue = escapedValue;
		}
	});

	$effect(() => {
		if (!isTranslationWbwMappingMode()) {
			wasWbwMappingMode = false;
			return;
		}
		if (arabicWordCount() <= 0) return;
		if (!wasWbwMappingMode) {
			translationsEditorState().translationWbwActiveArabicWordIndex =
				getNextUnmappedArabicWordIndex(0);
			wasWbwMappingMode = true;
			return;
		}
		const activeIndex = translationsEditorState().translationWbwActiveArabicWordIndex;
		if (activeIndex < 0 || activeIndex >= arabicWordCount()) {
			translationsEditorState().translationWbwActiveArabicWordIndex =
				getNextUnmappedArabicWordIndex(0);
		}
	});
</script>

<div
	class="flex flex-col gap-3 mt-4 p-4 bg-accent border border-color rounded-lg transition-all duration-200 group"
	onmouseleave={() => {
		handleMouseUp();
		handleInlineMouseUp();
	}}
>
	{#if translation()}
		{@const status = translation().status}
		{@const isCompleted = translation().isStatusComplete()}

		<!-- En-tête avec flag et info -->
		<div class="flex items-center gap-3 pb-2 border-b border-color">
			<div class="flex items-center gap-2">
				{#if translationMetadata()?.flag}
					<img src={translationMetadata()!.flag} alt={edition.language} class="w-5 h-5 rounded" />
				{:else if translationMetadata()}
					<div class="w-5 h-5 rounded-sm bg-black border border-color shrink-0"></div>
				{/if}
				<div>
					<p class="text-primary text-sm font-medium">{edition.language}</p>
					<p class="text-thirdly text-xs">{edition.author}</p>
				</div>
			</div>

			<div class="ml-auto">
				<div class="flex items-center gap-2">
					<span class="text-xs text-secondary font-medium">{$LL.editor.statusLabel()}</span>
					<div
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 {status ===
							'ai error' || status === 'error'
							? 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/30'
							: isCompleted
								? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30 hover:bg-green-500/30'
								: 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30 hover:bg-orange-500/30'}"
					>
						<div
							class="w-1.5 h-1.5 rounded-full {status === 'ai error' || status === 'error'
								? 'bg-red-500'
								: isCompleted
									? 'bg-green-500'
									: 'bg-orange-500'}"
						></div>
						{#if status === 'completed by default'}
							{$LL.editor.completedByDefault()}
						{:else if status === 'automatically trimmed'}
							{$LL.editor.automaticallyTrimmed()}
						{:else if status === 'fetched'}
							{$LL.editor.fetched()}
						{:else if status === 'to review'}
							{$LL.editor.toReview()}
						{:else if status === 'reviewed'}
							{$LL.editor.reviewed()}
						{:else if status === 'ai trimmed'}
							{$LL.editor.aiTrimmed()}
						{:else if status === 'ai error'}
							{$LL.editor.aiError()}
						{:else if status === 'error'}
							{$LL.editor.errorStatus()}
						{:else if status === 'undefined'}
							{$LL.editor.undefinedStatus()}
						{:else}
							{status}
						{/if}
					</div>
				</div>
			</div>
		</div>

		{#if translation().type === 'verse' && !isInlineStyleMode() && !isTranslationWbwMappingMode()}
			<!-- Affiche la traduction complète du verset mot à mot -->
			<div
				class="flex flex-row select-none flex-wrap items-center gap-y-1 duration-300 {translation()
					.isBruteForce
					? 'opacity-[0.14] group-hover:opacity-[0.55]'
					: 'opacity-20 group-hover:opacity-100'}"
				role="presentation"
				onmouseup={handleGlobalMouseUp}
				transition:slide
			>
				{#each originalTranslationUnits() as unit, i (`${i}-${unit.text}`)}
					{@const isSelected = translation().startWordIndex <= i && i <= translation().endWordIndex}
					{@const isFirstSelected = isSelected && i === translation().startWordIndex}
					{@const isLastSelected = isSelected && i === translation().endWordIndex}
					{@const isSingleSelected =
						isSelected && translation().startWordIndex === translation().endWordIndex}
					{@const isPreviousSubtitleTranslation =
						previousSubtitleTranslationStartIndex !== -1 &&
						previousSubtitleTranslationStartIndex <= i &&
						i <= previousSubtitleTranslationEndIndex}
					<button
						class="translation-word text-sm cursor-pointer px-1 py-1 transition-all duration-200 border-2 border-transparent
						{isPreviousSubtitleTranslation && !isSelected
							? 'bg-yellow-500/10 hover:bg-yellow-500/20! hover:border-yellow-400/20! rounded-none border-yellow-400/10'
							: ''}
						{isSelected
							? // Effet jaune si le mot est sélectionné alors que pourtant il ne devrait pas comme c'est la suite de la traduction du verset précédent
								`translation-word-selected ${isPreviousSubtitleTranslation ? 'bg-purple-500/30! border-purple-400/70! hover:bg-purple-500/80! hover:border-purple-400/80!' : ''} text-[var(--text-on-selected-word)] ${
									isSingleSelected
										? 'translation-word-first-selected translation-word-last-selected'
										: isLastSelected
											? 'translation-word-first-selected'
											: isFirstSelected
												? 'translation-word-last-selected'
												: 'translation-word-middle-selected'
								}`
							: 'translation-word-not-selected text-secondary hover:bg-secondary hover:border-border-color hover:text-primary rounded-md'}
						{isDragging ? 'select-none' : ''}"
						onmousedown={(event) => handleMouseDown(i, event)}
						onmouseenter={() => handleMouseEnter(i)}
						ondragstart={(event) => event.preventDefault()}
					>
						{unit.text}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Indicateur de sélection - toujours visible -->
		<div class="p-2 bg-secondary border border-color rounded-md relative">
			{#if translation().type === 'verse' && !isInlineStyleMode() && !isTranslationWbwMappingMode()}
				<!-- toggle: brute force -->
				<label
					class="absolute top-1 right-1.75 text-primary opacity-40 hover:opacity-100 duration-200 cursor-pointer"
				>
					<span class="text-xs">{$LL.editor.manuallyEdit()}</span>
					<!-- prettier-ignore -->
					<input
						type="checkbox"
						bind:checked={(subtitle.translations[edition.name] as VerseTranslation).isBruteForce}
						onchange={(e) => {
							ProjectHistoryManager.track('toggle manual translation edit', () => {
								if ((e.target as HTMLInputElement).checked) {
									translation().updateStatus('reviewed', edition);
									setTimeout(() => {
										if (translationInput) {
											translationInput.focus();
										}
									}, 0);
								} else {
									updateTranslationText();
									scheduleManualReviewTelemetry();
								}
							});
						}}
						class="w-2 h-2 scale-75 rounded"
					/>
				</label>
			{/if}

			<p class="text-xs text-thirdly mb-1">
				{isTranslationWbwMappingMode()
					? $LL.editor.translationWbwMapping()
					: isInlineStyleMode()
						? $LL.editor.styledSubtitleTranslation()
						: $LL.editor.subtitleTranslation()}
			</p>

			{#if translation().type === 'verse' && isTranslationWbwMappingMode()}
				<div class="space-y-2">
					<div class="flex justify-end">
						<button
							type="button"
							class="rounded-md border border-red-500/35 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
							onclick={clearAllWbwMappings}
						>
							{$LL.editor.clearAllWbwMappings()}
						</button>
					</div>
					{#each arabicWords() as arabicWord, arabicWordIndex (`${subtitle.id}-wbw-map-${arabicWordIndex}-${arabicWord}`)}
						<div class="rounded-lg border border-color bg-primary/30 px-3 py-2">
							<div class="mb-2 flex items-center justify-between gap-3 text-xs text-secondary">
								<div class="flex min-w-0 items-center gap-2">
									<span class="font-semibold text-primary arabic text-base" dir="rtl">
										{arabicWord}
									</span>
									<span class="shrink-0" dir={wbwTranslationDirection()}>
										{getWbwHelperWordLabel(arabicWordIndex)}
									</span>
								</div>
								<button
									type="button"
									class="shrink-0 rounded-md border border-color px-2 py-1 hover:bg-accent"
									onclick={() => clearCurrentWbwMapping(arabicWordIndex)}
								>
									{$LL.editor.clearCurrentWbwMapping()}
								</button>
							</div>
							<div class="translation-style-flow select-none" role="presentation">
								{#each getTrimmedTranslationWords() as word (`${arabicWordIndex}-${word.wordIndex}-${word.text}`)}
									{@const isSelected = isWbwUnitSelectedForArabicWord(
										arabicWordIndex,
										word.wordIndex
									)}
									<button
										class={`translation-word-style text-sm transition-all duration-150 ${
											isSelected
												? 'translation-word-style-selected text-primary shadow-sm'
												: 'text-primary'
										}`}
										style={getInlineStyleCss(word.flags)}
										onmousedown={(event) =>
											toggleWbwMappingUnit(arabicWordIndex, word.wordIndex, event)}
										ondragstart={(event) => event.preventDefault()}
									>
										{word.text}
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{:else if translation().type === 'verse' && isInlineStyleMode()}
				<div
					class="translation-style-flow select-none"
					onmouseup={handleGlobalMouseUp}
					role="presentation"
				>
					{#each getTrimmedTranslationWords() as word (`${word.wordIndex}-${word.text}`)}
						{@const isSelected =
							inlineSelectionStart !== -1 &&
							inlineSelectionEnd !== -1 &&
							inlineSelectionStart <= word.wordIndex &&
							word.wordIndex <= inlineSelectionEnd}
						<button
							class={`translation-word-style text-sm transition-all duration-150 ${
								isSelected
									? 'translation-word-style-selected text-primary shadow-sm'
									: 'text-primary'
							}`}
							style={getInlineStyleCss(word.flags)}
							onmousedown={(event) => handleInlineMouseDown(word.wordIndex, event)}
							onmouseenter={() => handleInlineMouseEnter(word.wordIndex)}
							ondragstart={(event) => event.preventDefault()}
						>
							{word.text}
						</button>
					{/each}
				</div>
			{:else if translation().type === 'verse' && !translation().isBruteForce}
				<p
					class="text-sm font-medium whitespace-pre-line"
					ondblclick={() => {
						ProjectHistoryManager.track('edit translation manually', () => {
							(subtitle.translations[edition.name] as VerseTranslation).isBruteForce = true;
							translation().updateStatus('reviewed', edition);
							// Met le focus sur l'input de traduction
							setTimeout(() => {
								if (translationInput) {
									translationInput.focus();
								}
							}, 0);
						});
					}}
				>
					{#each getStyledSegments() as segment, index (`${index}-${segment.text}`)}
						<span style={getInlineStyleCss(segment)}>{segment.text}</span>
					{/each}
				</p>
			{:else}
				<!-- prettier-ignore -->
				<input
					bind:this={translationInput}
					type="text"
					value={editableTranslationValue}
					onfocus={handleTranslationInputFocus}
					oninput={handleTranslationInput}
					onblur={handleTranslationInputBlur}
					class="w-full bg-secondary text-primary border border-color rounded-md px-2 py-1 text-sm"
					placeholder={$LL.translations.enterTranslationHere()}
				/>
			{/if}
		</div>
	{/if}
</div>

<style>
	.translation-word {
		border-left: 0px solid var(--accent-primary);
		border-right: 0px solid var(--accent-primary);
	}

	.translation-word-selected {
		background-color: var(--selected-word-bg);
		border-top: 2px solid var(--accent-primary);
		border-bottom: 2px solid var(--accent-primary);
	}

	.translation-word-first-selected {
		border-right: 2px solid var(--accent-primary);
		border-left: 0px solid var(--accent-primary);
		border-radius: 0 8px 8px 0;
		margin-left: 0;
	}

	.translation-word-last-selected {
		border-left: 2px solid var(--accent-primary);
		border-right: 0px solid var(--accent-primary);
		border-radius: 8px 0 0 8px;
		margin-right: 0;
	}

	/* Si un seul mot est sélectionné, il doit avoir des bords arrondis partout */
	.translation-word-first-selected.translation-word-last-selected {
		border-radius: 8px;
		border: 2px solid var(--accent-primary);
		margin-left: 0;
		margin-right: 0;
	}

	.translation-word-selected:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
		z-index: 10;
		position: relative;
	}

	.translation-word-not-selected:hover {
		background-color: var(--bg-accent);
		border-color: var(--border-color);
		color: var(--text-primary);
	}

	.translation-word-style {
		display: inline;
		padding: 0 0.06em;
		margin: 0 0.16em 0 0;
		border: none;
		border-radius: 0.3em;
		background: transparent;
		line-height: inherit;
		min-height: 0;
		box-shadow: none;
	}

	.translation-style-flow {
		font-size: 0.95rem;
		line-height: 1.7;
		color: var(--text-primary);
		cursor: text;
	}

	.translation-word-style:hover {
		background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
	}

	.translation-word-style-selected {
		background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
	}

	.translation-word-style-selected:hover {
		background: color-mix(in srgb, var(--accent-primary) 66%, transparent);
	}

	.translation-wbw-mapped {
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
		box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-primary) 50%, transparent);
	}

	/* Style pour la traduction du sous-titre précédent */
	.translation-word.bg-orange-500\/30 {
		background-color: rgba(249, 115, 22, 0.2);
		border-color: rgba(251, 146, 60, 0.3);
		position: relative;
	}

	.translation-word.bg-orange-500\/30::after {
		content: '';
		position: absolute;
		bottom: -2px;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, rgba(249, 115, 22, 0.6), transparent);
	}
</style>
