<script lang="ts">
	import type { Edition } from '$lib/classes';
	import type { SubtitleClip } from '$lib/classes/Clip.svelte';
	import {
		getInlineStyleCss,
		getInlineStyleFlagsForWordIndex,
		getTranslationTrimUnits,
		sliceTranslationTrimUnits,
		tokenizeTranslationText,
		toggleTranslationInlineStyleRuns,
		VerseTranslation,
		type QuranTranslationSegment,
		type TranslationInlineStyleFlags
	} from '$lib/classes/Translation.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		getStructuredTranslationDraft,
		serializeStructuredTranslation,
		type StructuredTranslationAnchor,
		type StructuredTranslationDraft
	} from '$lib/services/StructuredTranslationService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import {
		WbwTranslationService,
		type WbwTranslationLanguageCode
	} from '$lib/services/WbwTranslationService';
	import { get } from 'svelte/store';
	import TranslationWordSelector from './TranslationWordSelector.svelte';

	type StyledTranslationWord = {
		text: string;
		wordIndex: number;
		flags: TranslationInlineStyleFlags;
		style: string;
	};

	type TranslationCopy = {
		structuredTranslationHint: () => string;
		freeTextBefore: () => string;
		freeTextBetween: () => string;
		freeTextAfter: () => string;
		quranPassage: () => string;
		quotationBlock: () => string;
		protectedBlock: () => string;
		manualTranslation: () => string;
		editQuranRange: () => string;
		fullVerse: () => string;
		wordsRange: (args: { start: number; end: number }) => string;
		quranTranslationMissing: () => string;
		aiTranslatedStatus: () => string;
	};

	let {
		edition,
		subtitle
	}: {
		edition: Edition;
		subtitle: SubtitleClip;
		previousSubtitle?: SubtitleClip;
	} = $props();

	const copy = get(LL).translations as unknown as TranslationCopy;
	const translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);
	const translation = $derived(() => subtitle.getTranslation(edition) as VerseTranslation);
	const direction = $derived(() => (edition.direction === 'rtl' ? 'rtl' : 'ltr'));
	const draft = $derived(() => getStructuredTranslationDraft(subtitle.text, translation().text));
	const resolvedText = $derived(() =>
		globalState.getProjectTranslation.resolveStructuredTranslationText(
			edition,
			subtitle,
			translation()
		)
	);
	const requestedQuranVerses = new Set<string>();
	const requestedQuranWbwRanges = new Set<string>();
	let quranWbwWordsByKey = $state<Record<string, string[]>>({});
	let visibleOptionalFreeTextIndexes = $state<number[]>([]);
	let expandedFullVerseAnchorIds = $state<string[]>([]);
	let textHistoryActive = false;
	let quranDragAnchorId = $state<string | null>(null);
	let quranDragStartIndex = $state(-1);
	let quranDragHistoryActive = false;

	/**
	 * Retourne le libellé d'une zone libre selon sa position autour des ancres.
	 * @param {number} index Index de la zone libre.
	 * @param {number} anchorCount Nombre total d'ancres.
	 * @returns {string} Libellé localisé.
	 */
	function getFreeTextLabel(index: number, anchorCount: number): string {
		if (anchorCount === 0) return $LL.editor.subtitleTranslation();
		if (index === 0) return copy.freeTextBefore();
		if (index === anchorCount) return copy.freeTextAfter();
		return copy.freeTextBetween();
	}

	/**
	 * Indique si une zone libre est utile ou a été explicitement ouverte.
	 * @param {number} index Index de la zone libre.
	 * @returns {boolean} `true` lorsque le champ doit être affiché.
	 */
	function shouldShowFreeText(index: number): boolean {
		if (draft().anchors.length === 0) return true;
		return (
			Boolean(draft().sourceFreeTexts[index]?.trim()) ||
			Boolean(draft().freeTexts[index]?.trim()) ||
			visibleOptionalFreeTextIndexes.includes(index)
		);
	}

	/**
	 * Affiche une zone libre optionnelle sans modifier la traduction.
	 * @param {number} index Index de la zone libre.
	 * @returns {void}
	 */
	function showOptionalFreeText(index: number): void {
		if (visibleOptionalFreeTextIndexes.includes(index)) return;
		visibleOptionalFreeTextIndexes = [...visibleOptionalFreeTextIndexes, index];
	}

	/**
	 * Indique si une zone libre ne correspond à aucun texte source obligatoire.
	 * @param {number} index Index de la zone libre.
	 * @returns {boolean} `true` lorsque la zone peut être retirée.
	 */
	function isOptionalFreeText(index: number): boolean {
		return draft().anchors.length > 0 && !draft().sourceFreeTexts[index]?.trim();
	}

	/**
	 * Vide et masque une zone libre ajoutée manuellement.
	 * @param {number} index Index de la zone libre.
	 * @returns {void}
	 */
	function removeOptionalFreeText(index: number): void {
		if (!isOptionalFreeText(index)) return;
		if (draft().freeTexts[index]) {
			ProjectHistoryManager.track('remove optional translation text', () => {
				const nextDraft = getStructuredTranslationDraft(subtitle.text, translation().text);
				nextDraft.freeTexts[index] = '';
				saveDraft(nextDraft);
			});
		}
		visibleOptionalFreeTextIndexes = visibleOptionalFreeTextIndexes.filter(
			(visibleIndex) => visibleIndex !== index
		);
	}

	/**
	 * Affiche le sélecteur de plage d'un verset complet.
	 * @param {string} anchorId Identifiant de l'ancre Quran.
	 * @returns {void}
	 */
	function showFullVerseRangeSelector(anchorId: string): void {
		if (expandedFullVerseAnchorIds.includes(anchorId)) return;
		expandedFullVerseAnchorIds = [...expandedFullVerseAnchorIds, anchorId];
	}

	/**
	 * Insère la bénédiction prophétique à la position du curseur avec Ctrl+S.
	 * @param {KeyboardEvent} event Événement clavier du textarea.
	 * @param {(value: string) => void} update Fonction de mise à jour du champ.
	 * @returns {void}
	 */
	function handleBlessingShortcut(event: KeyboardEvent, update: (value: string) => void): void {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
		event.preventDefault();
		const textarea = event.currentTarget as HTMLTextAreaElement;
		const start = textarea.selectionStart ?? textarea.value.length;
		const end = textarea.selectionEnd ?? start;
		const nextValue = `${textarea.value.slice(0, start)}ﷺ${textarea.value.slice(end)}`;
		update(nextValue);
		requestAnimationFrame(() => {
			textarea.focus();
			textarea.setSelectionRange(start + 1, start + 1);
		});
	}

	/**
	 * Démarre une transaction d'historique pour une saisie textuelle continue.
	 * @returns {void}
	 */
	function beginTextHistory(): void {
		if (textHistoryActive) return;
		ProjectHistoryManager.begin('edit structured translation');
		textHistoryActive = true;
	}

	/**
	 * Termine la transaction de saisie en cours.
	 * @returns {void}
	 */
	function commitTextHistory(): void {
		if (!textHistoryActive) return;
		ProjectHistoryManager.commit();
		textHistoryActive = false;
	}

	/**
	 * Sauvegarde un brouillon segmenté et marque la traduction comme relue.
	 * @param {StructuredTranslationDraft} nextDraft Brouillon modifié.
	 * @returns {void}
	 */
	function saveDraft(nextDraft: StructuredTranslationDraft): void {
		translation().setTextAndClearInlineStyles(serializeStructuredTranslation(nextDraft));
		translation().clearWbwRanges();
		translation().status = 'reviewed';
		globalState.currentProject!.detail.updatePercentageTranslated(edition);
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Met à jour une zone de texte libre.
	 * @param {number} index Index de la zone.
	 * @param {string} value Nouveau texte.
	 * @returns {void}
	 */
	function updateFreeText(index: number, value: string): void {
		const nextDraft = getStructuredTranslationDraft(subtitle.text, translation().text);
		nextDraft.freeTexts[index] = value;
		saveDraft(nextDraft);
	}

	/**
	 * Met à jour la traduction d'une citation protégée.
	 * @param {number} index Index de l'ancre.
	 * @param {string} value Texte traduit de la citation.
	 * @returns {void}
	 */
	function updateCitation(index: number, value: string): void {
		const nextDraft = getStructuredTranslationDraft(subtitle.text, translation().text);
		nextDraft.anchors[index].value = value;
		saveDraft(nextDraft);
	}

	/**
	 * Retourne la traduction complète de l'édition pour une ancre Quran.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran.
	 * @returns {string} Traduction complète du verset.
	 */
	function getQuranOriginal(anchor: StructuredTranslationAnchor): string {
		const reference = anchor.quranReference;
		if (!reference) return '';
		return (
			globalState.getProjectTranslation.versesTranslations[edition.name]?.[
				`${reference.surah}:${reference.verse}`
			] ?? ''
		);
	}

	/**
	 * Charge à la demande une traduction Quran ajoutée après la création de la langue.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran à charger.
	 * @returns {void}
	 */
	function ensureQuranOriginal(anchor: StructuredTranslationAnchor): void {
		const reference = anchor.quranReference;
		const quranEdition = edition.quranEdition;
		if (!reference || !quranEdition || getQuranOriginal(anchor)) return;
		const verseKey = `${reference.surah}:${reference.verse}`;
		if (requestedQuranVerses.has(verseKey)) return;
		requestedQuranVerses.add(verseKey);

		void globalState.getProjectTranslation
			.downloadVerseTranslation(quranEdition, reference.surah, reference.verse)
			.then((text) => {
				if (!globalState.getProjectTranslation.versesTranslations[edition.name]) {
					globalState.getProjectTranslation.versesTranslations[edition.name] = {};
				}
				globalState.getProjectTranslation.versesTranslations[edition.name][verseKey] = text;
				globalState.updateVideoPreviewUI();
			});
	}

	/**
	 * Retourne la langue WBW choisie dans les paramètres de l'éditeur.
	 * @returns {WbwTranslationLanguageCode} Code de langue WBW à utiliser.
	 */
	function getQuranWbwLanguageCode(): WbwTranslationLanguageCode {
		return globalState.settings?.persistentUiState.wbwTranslationLanguage ?? 'en';
	}

	/**
	 * Construit la clé de cache WBW d'une ancre Quran partielle.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran concernée.
	 * @returns {string} Clé stable pour la plage et la langue.
	 */
	function getQuranWbwKey(anchor: StructuredTranslationAnchor): string {
		return `${anchor.id}:${anchor.sourceValue}:${getQuranWbwLanguageCode()}`;
	}

	/**
	 * Retourne les mots WBW déjà chargés pour une ancre Quran.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran concernée.
	 * @returns {string[]} Traductions mot à mot de la plage citée.
	 */
	function getQuranWbwWords(anchor: StructuredTranslationAnchor): string[] {
		return quranWbwWordsByKey[getQuranWbwKey(anchor)] ?? [];
	}

	/**
	 * Charge les traductions mot à mot de la plage Quran réellement citée.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran partielle.
	 * @returns {void}
	 */
	function ensureQuranWbwWords(anchor: StructuredTranslationAnchor): void {
		const reference = anchor.quranReference;
		if (!reference || reference.startWord === null || reference.endWord === null) {
			return;
		}

		const key = getQuranWbwKey(anchor);
		if (requestedQuranWbwRanges.has(key) || quranWbwWordsByKey[key]) return;
		requestedQuranWbwRanges.add(key);

		void WbwTranslationService.getWordsForRange(
			getQuranWbwLanguageCode(),
			reference.surah,
			reference.verse,
			reference.startWord - 1,
			reference.endWord - 1
		)
			.then((words) => {
				quranWbwWordsByKey = {
					...quranWbwWordsByKey,
					[key]: words.filter((word) => word.trim().length > 0)
				};
			})
			.catch(() => requestedQuranWbwRanges.delete(key));
	}

	/**
	 * Retourne les réglages persistants d'une ancre Quran.
	 * @param {StructuredTranslationAnchor} anchor Ancre concernée.
	 * @returns {QuranTranslationSegment} Réglages de sélection ou de traduction manuelle.
	 */
	function getQuranSettings(anchor: StructuredTranslationAnchor): QuranTranslationSegment {
		const units = getTranslationTrimUnits(getQuranOriginal(anchor));
		return translation().getQuranSegment(
			anchor.id,
			anchor.sourceValue,
			Math.max(0, units.length - 1)
		);
	}

	/**
	 * Retourne les réglages persistants d'une ancre Quran pour une mutation utilisateur.
	 * @param {StructuredTranslationAnchor} anchor Ancre concernée.
	 * @returns {QuranTranslationSegment} Réglages persistants de l'occurrence.
	 */
	function getMutableQuranSettings(anchor: StructuredTranslationAnchor): QuranTranslationSegment {
		const units = getTranslationTrimUnits(getQuranOriginal(anchor));
		return translation().getOrCreateQuranSegment(
			anchor.id,
			anchor.sourceValue,
			Math.max(0, units.length - 1)
		);
	}

	/**
	 * Retourne le texte Quran actuellement choisi pour une ancre.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran.
	 * @returns {string} Traduction de l'édition ou remplacement manuel.
	 */
	function getSelectedQuranText(anchor: StructuredTranslationAnchor): string {
		const settings = getQuranSettings(anchor);
		if (settings.isBruteForce) return settings.manualText;
		return sliceTranslationTrimUnits(
			getQuranOriginal(anchor),
			settings.startUnitIndex,
			settings.endUnitIndex
		);
	}

	/**
	 * Applique une plage continue à une ancre Quran pendant une sélection souris.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran concernée.
	 * @param {number} startUnitIndex Index de début.
	 * @param {number} endUnitIndex Index de fin.
	 * @returns {void}
	 */
	function updateQuranRange(
		anchor: StructuredTranslationAnchor,
		startUnitIndex: number,
		endUnitIndex: number
	): void {
		const settings = getMutableQuranSettings(anchor);
		settings.startUnitIndex = Math.min(startUnitIndex, endUnitIndex);
		settings.endUnitIndex = Math.max(startUnitIndex, endUnitIndex);
		settings.isBruteForce = false;
		translation().clearInlineStyles();
		translation().clearWbwRanges();
		translation().status = 'reviewed';
		globalState.currentProject!.detail.updatePercentageTranslated(edition);
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Démarre la sélection par glissement d'une traduction Quran.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran concernée.
	 * @param {number} unitIndex Index du premier mot.
	 * @param {MouseEvent} event Événement souris.
	 * @returns {void}
	 */
	function beginQuranRangeDrag(
		anchor: StructuredTranslationAnchor,
		unitIndex: number,
		event: MouseEvent
	): void {
		event.preventDefault();
		ProjectHistoryManager.begin('select Quran translation range');
		quranDragHistoryActive = true;
		quranDragAnchorId = anchor.id;
		quranDragStartIndex = unitIndex;
		updateQuranRange(anchor, unitIndex, unitIndex);
	}

	/**
	 * Étend la sélection Quran jusqu'au mot survolé.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran concernée.
	 * @param {number} unitIndex Index actuellement survolé.
	 * @returns {void}
	 */
	function extendQuranRangeDrag(anchor: StructuredTranslationAnchor, unitIndex: number): void {
		if (quranDragAnchorId !== anchor.id || quranDragStartIndex < 0) return;
		updateQuranRange(anchor, quranDragStartIndex, unitIndex);
	}

	/**
	 * Termine la transaction de sélection Quran en cours.
	 * @returns {void}
	 */
	function finishQuranRangeDrag(): void {
		quranDragAnchorId = null;
		quranDragStartIndex = -1;
		if (!quranDragHistoryActive) return;
		ProjectHistoryManager.commit();
		quranDragHistoryActive = false;
	}

	/**
	 * Sélectionne un seul mot Quran au clavier.
	 * @param {StructuredTranslationAnchor} anchor Ancre Quran concernée.
	 * @param {number} unitIndex Index du mot.
	 * @returns {void}
	 */
	function selectSingleQuranUnit(anchor: StructuredTranslationAnchor, unitIndex: number): void {
		ProjectHistoryManager.track('select Quran translation range', () => {
			updateQuranRange(anchor, unitIndex, unitIndex);
		});
	}

	/**
	 * Active ou désactive la traduction manuelle d'une ancre Quran.
	 * @param {StructuredTranslationAnchor} anchor Ancre concernée.
	 * @param {boolean} manual État du mode manuel.
	 * @returns {void}
	 */
	function setQuranManualMode(anchor: StructuredTranslationAnchor, manual: boolean): void {
		ProjectHistoryManager.track('toggle manual Quran translation', () => {
			const settings = getMutableQuranSettings(anchor);
			if (manual && !settings.manualText) settings.manualText = getSelectedQuranText(anchor);
			settings.isBruteForce = manual;
			translation().clearInlineStyles();
			translation().clearWbwRanges();
			translation().updateStatus('to translate', edition);
		});
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Met à jour le remplacement manuel d'une ancre Quran.
	 * @param {StructuredTranslationAnchor} anchor Ancre concernée.
	 * @param {string} value Nouveau texte manuel.
	 * @returns {void}
	 */
	function updateQuranManualText(anchor: StructuredTranslationAnchor, value: string): void {
		const settings = getMutableQuranSettings(anchor);
		settings.manualText = value;
		translation().clearInlineStyles();
		translation().clearWbwRanges();
		translation().updateStatus('reviewed', edition);
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Retourne les mots stylables de la traduction finale résolue.
	 * @returns {StyledTranslationWord[]} Liste de mots et leurs styles actuels.
	 */
	function getStyledWords(): StyledTranslationWord[] {
		return tokenizeTranslationText(resolvedText())
			.filter((token) => token.isWord && token.wordIndex !== null)
			.map((token) => ({
				text: token.text,
				wordIndex: token.wordIndex!,
				flags: getInlineStyleFlagsForWordIndex(
					translation().inlineStyleRuns ?? [],
					token.wordIndex!
				),
				style: getInlineStyleCss(
					getInlineStyleFlagsForWordIndex(translation().inlineStyleRuns ?? [], token.wordIndex!)
				)
			}));
	}

	/**
	 * Applique les styles actifs du panneau droit sur une plage de mots résolus.
	 * @param {number} start Index de début.
	 * @param {number} end Index de fin.
	 * @returns {void}
	 */
	function applyInlineStyles(start: number, end: number): void {
		const flags: TranslationInlineStyleFlags = {
			bold: translationsEditorState().inlineStyleBoldEnabled,
			italic: translationsEditorState().inlineStyleItalicEnabled,
			underline: translationsEditorState().inlineStyleUnderlineEnabled,
			lineBreak: translationsEditorState().inlineStyleLineBreakEnabled,
			color: translationsEditorState().inlineStyleColorEnabled
				? translationsEditorState().inlineStyleColorValue
				: null,
			glow: translationsEditorState().inlineStyleGlowEnabled
				? translationsEditorState().inlineStyleGlowColorValue
				: null
		};
		const wordCount = getStyledWords().length;
		ProjectHistoryManager.track('style translation words', () => {
			translation().inlineStyleRuns = toggleTranslationInlineStyleRuns(
				translation().inlineStyleRuns ?? [],
				wordCount,
				start,
				end,
				flags
			);
		});
		globalState.updateVideoPreviewUI();
	}

	$effect(() => {
		for (const anchor of draft().anchors) {
			if (anchor.type !== 'quran') continue;
			ensureQuranOriginal(anchor);
			ensureQuranWbwWords(anchor);
		}
	});
</script>

<svelte:window onmouseup={finishQuranRangeDrag} />

<div class="rounded-xl border border-color bg-accent p-4 transition-colors">
	<div class="flex items-center gap-3 border-b border-color pb-3">
		{#if globalState.getTranslationMetadata(edition.language)?.flag}
			<img
				src={globalState.getTranslationMetadata(edition.language)!.flag}
				alt={edition.language}
				class="h-5 w-5 rounded-sm"
			/>
		{/if}
		<div class="min-w-0">
			<p class="text-sm font-semibold text-primary">{edition.language}</p>
			<p class="truncate text-xs text-thirdly">{edition.quranEdition?.author ?? ''}</p>
		</div>
		<div class="ml-auto flex items-center gap-2">
			<span
				class="rounded-full border px-2 py-1 text-xs {translation().status === 'ai translated'
					? 'border-blue-500/30 bg-blue-500/15 text-blue-300'
					: translation().isStatusComplete()
						? 'border-green-500/30 bg-green-500/15 text-green-300'
						: 'border-orange-500/30 bg-orange-500/15 text-orange-300'}"
			>
				{translation().status === 'completed by default'
					? $LL.editor.completedByDefault()
					: translation().status === 'ai translated'
						? copy.aiTranslatedStatus()
						: translation().status === 'reviewed'
							? $LL.editor.reviewed()
							: $LL.editor.toReview()}
			</span>
		</div>
	</div>

	{#if translationsEditorState().isInlineStyleMode}
		<div class="mt-4 rounded-lg border border-color bg-secondary p-3">
			<p class="mb-3 whitespace-pre-line text-sm text-primary" dir={direction()}>
				{resolvedText()}
			</p>
			<TranslationWordSelector
				words={getStyledWords()}
				direction={direction()}
				onSelection={applyInlineStyles}
			/>
		</div>
	{:else}
		<div class="mt-4 space-y-3" dir={direction()}>
			{#each draft().anchors as anchor, anchorIndex (anchor.id)}
				{#if shouldShowFreeText(anchorIndex)}
					<div class="relative">
						<label class="block">
							<span
								class="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-thirdly"
							>
								{getFreeTextLabel(anchorIndex, draft().anchors.length)}
							</span>
							<textarea
								value={draft().freeTexts[anchorIndex]}
								onfocus={beginTextHistory}
								oninput={(event) => updateFreeText(anchorIndex, event.currentTarget.value)}
								onkeydown={(event) =>
									handleBlessingShortcut(event, (value) => updateFreeText(anchorIndex, value))}
								onblur={commitTextHistory}
								rows="2"
								class="w-full resize-y rounded-lg border border-dashed border-color bg-secondary px-3 py-2 text-sm text-primary"
								placeholder={$LL.translations.enterTranslationHere()}
							></textarea>
						</label>
						{#if isOptionalFreeText(anchorIndex)}
							<button
								type="button"
								class="absolute right-0 -top-1 rounded p-0.5 text-thirdly opacity-15 transition hover:bg-secondary hover:opacity-70"
								aria-label={`${$LL.common.remove()} ${getFreeTextLabel(anchorIndex, draft().anchors.length)}`}
								onclick={() => removeOptionalFreeText(anchorIndex)}
							>
								<span class="material-icons text-sm">close</span>
							</button>
						{/if}
					</div>
				{:else}
					<button
						type="button"
						class="mx-auto flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-thirdly opacity-30 transition hover:bg-secondary hover:opacity-100"
						aria-label={`${$LL.translations.add()} ${getFreeTextLabel(anchorIndex, draft().anchors.length)}`}
						onclick={() => showOptionalFreeText(anchorIndex)}
					>
						<span class="material-icons text-sm">add</span>
						{getFreeTextLabel(anchorIndex, draft().anchors.length)}
					</button>
				{/if}

				{#if anchor.type === 'citation'}
					<div class="rounded-xl border border-amber-500/35 bg-amber-500/8 p-3" dir={direction()}>
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="flex items-center gap-2">
								<span class="material-icons-outlined text-amber-300">format_quote</span>
								<div>
									<p class="text-sm font-semibold text-primary">{copy.quotationBlock()}</p>
								</div>
							</div>
						</div>
						<textarea
							value={anchor.value}
							onfocus={beginTextHistory}
							oninput={(event) => updateCitation(anchorIndex, event.currentTarget.value)}
							onkeydown={(event) =>
								handleBlessingShortcut(event, (value) => updateCitation(anchorIndex, value))}
							onblur={commitTextHistory}
							rows="3"
							class="w-full resize-y rounded-lg border border-amber-500/25 bg-secondary px-3 py-2 text-sm text-primary"
							placeholder={$LL.translations.enterTranslationHere()}
						></textarea>
					</div>
				{:else}
					{@const reference = anchor.quranReference}
					{@const quranOriginal = getQuranOriginal(anchor)}
					{@const units = getTranslationTrimUnits(quranOriginal)}
					{@const settings = getQuranSettings(anchor)}
					{@const quranWbwWords = getQuranWbwWords(anchor)}
					{@const isFullVerse = reference?.startWord === null}
					{@const lastUnitIndex = Math.max(0, units.length - 1)}
					{@const hasCustomQuranRange =
						settings.startUnitIndex > 0 || settings.endUnitIndex < lastUnitIndex}
					{@const showQuranRangeSelector =
						!isFullVerse || hasCustomQuranRange || expandedFullVerseAnchorIds.includes(anchor.id)}
					<div
						class="rounded-xl border border-emerald-500/35 bg-emerald-500/8 p-3"
						dir={direction()}
					>
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold text-primary">
									{copy.quranPassage()}
									{reference?.surah}:{reference?.verse}
									{#if isFullVerse}
										<span class="font-normal text-thirdly"> ({copy.fullVerse()})</span>
									{:else}
										<span class="ml-2 text-xs font-normal text-thirdly">
											{copy.wordsRange({
												start: reference?.startWord ?? 1,
												end: reference?.endWord ?? 1
											})}
										</span>
									{/if}
								</p>
								{#if !isFullVerse}
									{#if quranWbwWords.length > 0}
										<div
											class="mt-0.5 flex max-w-xl flex-wrap items-center gap-x-1 text-[11px] text-thirdly opacity-65"
											dir={WbwTranslationService.getLanguageDirection(getQuranWbwLanguageCode())}
										>
											<span class="material-icons-outlined text-xs! opacity-70">translate</span>
											<span>{quranWbwWords.join(' · ')}</span>
										</div>
									{/if}
								{/if}
							</div>
							<div class="flex items-center gap-3">
								{#if isFullVerse && !showQuranRangeSelector}
									<button
										type="button"
										class="flex items-center gap-1 text-xs text-thirdly opacity-55 transition hover:text-primary hover:opacity-100"
										onclick={() => showFullVerseRangeSelector(anchor.id)}
									>
										<span class="material-icons text-sm">tune</span>
										{copy.editQuranRange()}
									</button>
								{/if}
								<label class="flex cursor-pointer items-center gap-2 text-xs text-secondary">
									<input
										type="checkbox"
										checked={settings.isBruteForce}
										onchange={(event) => setQuranManualMode(anchor, event.currentTarget.checked)}
									/>
									{copy.manualTranslation()}
								</label>
							</div>
						</div>

						{#if !quranOriginal}
							<p class="mt-3 text-sm text-thirdly">{copy.quranTranslationMissing()}</p>
						{:else if settings.isBruteForce}
							<textarea
								value={settings.manualText}
								onfocus={beginTextHistory}
								oninput={(event) => updateQuranManualText(anchor, event.currentTarget.value)}
								onkeydown={(event) =>
									handleBlessingShortcut(event, (value) => updateQuranManualText(anchor, value))}
								onblur={commitTextHistory}
								rows="3"
								class="mt-3 w-full resize-y rounded-lg border border-emerald-500/25 bg-secondary px-3 py-2 text-sm text-primary"
							></textarea>
						{:else if isFullVerse && !showQuranRangeSelector}
							<div class="mt-3 rounded-lg border border-emerald-400/35 bg-emerald-500/7 px-4 py-3">
								<p class="whitespace-pre-line text-sm font-medium leading-relaxed text-primary">
									{getSelectedQuranText(anchor)}
								</p>
							</div>
						{:else}
							<div class="mt-3 rounded-lg border border-color bg-secondary p-3">
								<p class="mb-2 text-xs font-semibold text-thirdly">{copy.editQuranRange()}</p>
								<div
									class="flex select-none flex-wrap items-center gap-y-1"
									role="presentation"
									onmouseup={finishQuranRangeDrag}
								>
									{#each units as unit, unitIndex (`${anchor.id}-${unitIndex}-${unit.text}`)}
										{@const isSelected =
											settings.startUnitIndex <= unitIndex && unitIndex <= settings.endUnitIndex}
										{@const isFirstSelected = isSelected && unitIndex === settings.startUnitIndex}
										{@const isLastSelected = isSelected && unitIndex === settings.endUnitIndex}
										{@const isSingleSelected =
											isSelected && settings.startUnitIndex === settings.endUnitIndex}
										{@const selectedEdgeClass =
											direction() === 'rtl'
												? isLastSelected
													? 'translation-word-last-selected'
													: isFirstSelected
														? 'translation-word-first-selected'
														: 'translation-word-middle-selected'
												: isLastSelected
													? 'translation-word-first-selected'
													: isFirstSelected
														? 'translation-word-last-selected'
														: 'translation-word-middle-selected'}
										<button
											type="button"
											class="translation-word cursor-pointer border-2 border-transparent px-1 py-1 text-sm transition-all duration-200 {isSelected
												? `translation-word-selected text-[var(--text-on-selected-word)] ${
														isSingleSelected
															? 'translation-word-first-selected translation-word-last-selected'
															: selectedEdgeClass
													}`
												: 'translation-word-not-selected rounded-md text-secondary'}"
											onmousedown={(event) => beginQuranRangeDrag(anchor, unitIndex, event)}
											onmouseenter={() => extendQuranRangeDrag(anchor, unitIndex)}
											onkeydown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													selectSingleQuranUnit(anchor, unitIndex);
												}
											}}
											ondragstart={(event) => event.preventDefault()}
										>
											{unit.text}
										</button>
									{/each}
								</div>
								<p class="mt-3 whitespace-pre-line text-sm font-medium text-primary">
									{getSelectedQuranText(anchor)}
								</p>
							</div>
						{/if}
					</div>
				{/if}
			{/each}

			{#if shouldShowFreeText(draft().anchors.length)}
				<div class="relative">
					<label class="block">
						<span
							class="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-thirdly"
						>
							{getFreeTextLabel(draft().anchors.length, draft().anchors.length)}
						</span>
						<textarea
							value={draft().freeTexts[draft().anchors.length]}
							onfocus={beginTextHistory}
							oninput={(event) => updateFreeText(draft().anchors.length, event.currentTarget.value)}
							onkeydown={(event) =>
								handleBlessingShortcut(event, (value) =>
									updateFreeText(draft().anchors.length, value)
								)}
							onblur={commitTextHistory}
							rows={draft().anchors.length === 0 ? 4 : 2}
							class="w-full resize-y rounded-lg border border-dashed border-color bg-secondary px-3 py-2 text-sm text-primary"
							placeholder={$LL.translations.enterTranslationHere()}
						></textarea>
					</label>
					{#if isOptionalFreeText(draft().anchors.length)}
						<button
							type="button"
							class="absolute right-0 -top-1 rounded p-0.5 text-thirdly opacity-15 transition hover:bg-secondary hover:opacity-70"
							aria-label={`${$LL.common.remove()} ${getFreeTextLabel(draft().anchors.length, draft().anchors.length)}`}
							onclick={() => removeOptionalFreeText(draft().anchors.length)}
						>
							<span class="material-icons text-sm">close</span>
						</button>
					{/if}
				</div>
			{:else}
				<button
					type="button"
					class="mx-auto flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-thirdly opacity-30 transition hover:bg-secondary hover:opacity-100"
					aria-label={`${$LL.translations.add()} ${getFreeTextLabel(draft().anchors.length, draft().anchors.length)}`}
					onclick={() => showOptionalFreeText(draft().anchors.length)}
				>
					<span class="material-icons text-sm">add</span>
					{getFreeTextLabel(draft().anchors.length, draft().anchors.length)}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.translation-word {
		border-left: 0 solid var(--accent-primary);
		border-right: 0 solid var(--accent-primary);
	}

	.translation-word-selected {
		background-color: var(--selected-word-bg);
		border-top: 2px solid var(--accent-primary);
		border-bottom: 2px solid var(--accent-primary);
	}

	.translation-word-first-selected {
		border-right: 2px solid var(--accent-primary);
		border-left: 0 solid var(--accent-primary);
		border-radius: 0 8px 8px 0;
	}

	.translation-word-last-selected {
		border-left: 2px solid var(--accent-primary);
		border-right: 0 solid var(--accent-primary);
		border-radius: 8px 0 0 8px;
	}

	.translation-word-first-selected.translation-word-last-selected {
		border: 2px solid var(--accent-primary);
		border-radius: 8px;
	}

	.translation-word-selected:hover {
		position: relative;
		z-index: 10;
		background: var(--bg-accent);
		color: var(--text-primary);
	}

	.translation-word-not-selected:hover {
		background-color: var(--bg-accent);
		border-color: var(--border-color);
		color: var(--text-primary);
	}
</style>
