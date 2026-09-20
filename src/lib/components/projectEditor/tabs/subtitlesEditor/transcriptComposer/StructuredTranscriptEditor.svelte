<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import { Quran } from '$lib/classes/Quran';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		getStructuredTranslationDraft,
		serializeStructuredTranslation,
		type StructuredTranslationDraft
	} from '$lib/services/StructuredTranslationService';
	import type { QuranTranscriptReference } from '$lib/services/TranscriptReferenceService';
	import { get } from 'svelte/store';
	import { untrack } from 'svelte';
	import QuranPassageSelector from './QuranPassageSelector.svelte';
	import TranscriptAnchorBlock from './TranscriptAnchorBlock.svelte';
	import TranscriptPartInput from './TranscriptPartInput.svelte';

	type Props = {
		value: string;
		input?: HTMLTextAreaElement | null;
		isEditing: boolean;
		onCancelEditing: () => void;
		onSubmit: () => void | Promise<void>;
	};

	type TranscriptionCopy = {
		insertVerse: () => string;
		insertQuotation: () => string;
		convertToQuotation: () => string;
		convertQuotationToText: () => string;
		selectQuranPassage: () => string;
		decreaseTranscriptTextSize: () => string;
		increaseTranscriptTextSize: () => string;
		confirmEditing: () => string;
		exitEditing: () => string;
	};

	const INSERT_BUTTON_CLASS =
		'flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-primary transition';
	const FONT_SIZE_BUTTON_CLASS =
		'flex h-7 w-7 cursor-pointer items-center justify-center text-secondary transition hover:bg-accent hover:text-primary disabled:cursor-default disabled:opacity-40';

	let {
		value = $bindable(),
		input = $bindable(null),
		isEditing,
		onCancelEditing,
		onSubmit
	}: Props = $props();

	const initialValue = untrack(() => value);
	let lastSerializedText = initialValue;
	let transcriptDraft = $state<StructuredTranslationDraft>(
		getStructuredTranslationDraft(initialValue, initialValue)
	);
	let transcriptFontSize = $state(globalState.settings?.persistentUiState.transcriptFontSize ?? 16);
	let activeVerseAnchorIndex: number | null = $state(null);
	let verseSelectorIsNew = $state(false);
	let nextAnchorId = 0;

	const copy = get(LL).editor as unknown as TranscriptionCopy;
	const transcriptDirection = $derived(() => getTranscriptDirection());
	const transcriptInputHeight = $derived(
		48 + Math.ceil(Math.max(0, transcriptFontSize - 16) * 1.5)
	);
	const transcriptFontStyle = $derived(`font-size: ${transcriptFontSize}px !important`);
	const transcriptInputStyle = $derived(
		`${transcriptFontStyle}; height: ${transcriptInputHeight}px !important; min-height: ${transcriptInputHeight}px !important; max-height: ${transcriptInputHeight}px !important`
	);
	const transcriptBlockStyle = $derived(`height: ${transcriptInputHeight}px`);
	const activeQuranReference = $derived(
		activeVerseAnchorIndex === null
			? null
			: (transcriptDraft.anchors[activeVerseAnchorIndex]?.quranReference ?? null)
	);

	$effect(() => {
		void Quran.load();
	});

	// Recharge uniquement les valeurs imposées par le parent; les frappes locales sont déjà synchronisées.
	$effect(() => {
		if (value !== lastSerializedText) loadTranscriptDraft(value);
	});

	/**
	 * Charge un texte sérialisé dans l'éditeur structuré.
	 * @param {string} text Texte de transcription contenant éventuellement des marqueurs.
	 * @returns {void}
	 */
	function loadTranscriptDraft(text: string): void {
		lastSerializedText = text;
		transcriptDraft = getStructuredTranslationDraft(text, text);
		activeVerseAnchorIndex = null;
		verseSelectorIsNew = false;
	}

	/**
	 * Met à jour et sauvegarde la taille d'affichage du transcript.
	 * @param {number} delta Variation demandée en pixels.
	 * @returns {void}
	 */
	function changeTranscriptFontSize(delta: number): void {
		transcriptFontSize = Math.max(12, Math.min(32, transcriptFontSize + delta));
		if (!globalState.settings) return;
		globalState.settings.persistentUiState.transcriptFontSize = transcriptFontSize;
		void Settings.save();
	}

	/**
	 * Sérialise l'état courant sans exposer les marqueurs dans l'interface.
	 * @returns {void}
	 */
	function syncTranscriptText(): void {
		lastSerializedText = serializeStructuredTranslation(transcriptDraft);
		value = lastSerializedText;
	}

	/**
	 * Détermine le sens du composeur depuis le premier contenu textuel affiché.
	 * @returns {'ltr' | 'rtl'} Sens de lecture des blocs.
	 */
	function getTranscriptDirection(): 'ltr' | 'rtl' {
		let displayText = '';
		for (let index = 0; index < transcriptDraft.anchors.length; index++) {
			displayText += transcriptDraft.freeTexts[index] ?? '';
			const anchor = transcriptDraft.anchors[index];
			displayText += anchor.type === 'quran' ? 'ا' : anchor.value;
		}
		displayText += transcriptDraft.freeTexts[transcriptDraft.anchors.length] ?? '';
		const firstStrongCharacter = displayText.match(
			/[\p{Script=Arabic}\p{Script=Hebrew}\p{L}]/u
		)?.[0];
		return firstStrongCharacter &&
			/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(firstStrongCharacter)
			? 'rtl'
			: 'ltr';
	}

	/**
	 * Met à jour une zone de texte libre.
	 * @param {number} index Index de la zone.
	 * @param {string} nextValue Nouvelle valeur.
	 * @returns {void}
	 */
	function updateFreeText(index: number, nextValue: string): void {
		transcriptDraft.freeTexts[index] = nextValue;
		syncTranscriptText();
	}

	/**
	 * Met à jour le contenu d'une citation.
	 * @param {number} index Index de l'ancre.
	 * @param {string} nextValue Nouveau contenu.
	 * @returns {void}
	 */
	function updateQuotation(index: number, nextValue: string): void {
		transcriptDraft.anchors[index].value = nextValue;
		syncTranscriptText();
	}

	/**
	 * Convertit une zone de texte libre entière en citation au même emplacement.
	 * @param {number} index Index de la zone libre.
	 * @returns {void}
	 */
	function convertTextToQuotation(index: number): void {
		const text = transcriptDraft.freeTexts[index] ?? '';
		if (!text.trim()) return;
		transcriptDraft.freeTexts[index] = '';
		transcriptDraft.freeTexts.splice(index + 1, 0, '');
		transcriptDraft.anchors.splice(index, 0, {
			id: `transcript-${nextAnchorId++}`,
			index,
			type: 'citation',
			sourceValue: text,
			value: text,
			quranReference: null
		});
		syncTranscriptText();
	}

	/**
	 * Convertit une citation en texte libre sans perdre les textes voisins.
	 * @param {number} index Index de l'ancre de citation.
	 * @returns {void}
	 */
	function convertQuotationToText(index: number): void {
		const anchor = transcriptDraft.anchors[index];
		if (anchor?.type !== 'citation') return;
		transcriptDraft.freeTexts[index] =
			(transcriptDraft.freeTexts[index] ?? '') +
			anchor.value +
			(transcriptDraft.freeTexts[index + 1] ?? '');
		transcriptDraft.freeTexts.splice(index + 1, 1);
		transcriptDraft.anchors.splice(index, 1);
		syncTranscriptText();
	}

	/**
	 * Ajoute une ancre à la fin logique du sous-titre.
	 * @param {'quran' | 'citation'} type Type de bloc à insérer.
	 * @returns {void}
	 */
	function insertAnchor(type: 'quran' | 'citation'): void {
		const index = transcriptDraft.anchors.length;
		const freeText = transcriptDraft.freeTexts[index] ?? '';
		transcriptDraft.freeTexts[index] = freeText;
		transcriptDraft.freeTexts.push('');
		transcriptDraft.anchors.splice(index, 0, {
			id: `transcript-${nextAnchorId++}`,
			index,
			type,
			sourceValue: type === 'quran' ? '1:1' : '',
			value: type === 'quran' ? '1:1' : '',
			quranReference:
				type === 'quran' ? { surah: 1, verse: 1, startWord: null, endWord: null } : null
		});
		syncTranscriptText();
		if (type === 'quran') openVerseSelector(index, true);
	}

	/**
	 * Supprime un bloc et fusionne les textes libres qui l'entourent.
	 * @param {number} index Index de l'ancre.
	 * @returns {void}
	 */
	function removeAnchor(index: number): void {
		transcriptDraft.freeTexts[index] =
			(transcriptDraft.freeTexts[index] ?? '') + (transcriptDraft.freeTexts[index + 1] ?? '');
		transcriptDraft.freeTexts.splice(index + 1, 1);
		transcriptDraft.anchors.splice(index, 1);
		if (activeVerseAnchorIndex === index) {
			activeVerseAnchorIndex = null;
			verseSelectorIsNew = false;
		} else if (activeVerseAnchorIndex !== null && activeVerseAnchorIndex > index) {
			activeVerseAnchorIndex -= 1;
		}
		syncTranscriptText();
	}

	/**
	 * Ouvre le sélecteur pour une ancre Quran.
	 * @param {number} index Index de l'ancre.
	 * @param {boolean} isNew Indique si l'ancre doit être supprimée en cas d'annulation.
	 * @returns {void}
	 */
	function openVerseSelector(index: number, isNew: boolean = false): void {
		if (!transcriptDraft.anchors[index]?.quranReference) return;
		activeVerseAnchorIndex = index;
		verseSelectorIsNew = isNew;
	}

	/**
	 * Ferme le sélecteur et retire une ancre qui n'a jamais été confirmée.
	 * @returns {void}
	 */
	function cancelVerseSelection(): void {
		const index = activeVerseAnchorIndex;
		const shouldRemoveAnchor = verseSelectorIsNew;
		activeVerseAnchorIndex = null;
		verseSelectorIsNew = false;
		if (shouldRemoveAnchor && index !== null) removeAnchor(index);
	}

	/**
	 * Applique une référence Quran à l'ancre active.
	 * @param {QuranTranscriptReference} reference Référence et plage de mots sélectionnées.
	 * @returns {void}
	 */
	function applyVerseSelection(reference: QuranTranscriptReference): void {
		if (activeVerseAnchorIndex === null) return;
		const sourceValue =
			reference.startWord === null || reference.endWord === null
				? `${reference.surah}:${reference.verse}`
				: `${reference.surah}:${reference.verse}:${reference.startWord}-${reference.endWord}`;
		const anchor = transcriptDraft.anchors[activeVerseAnchorIndex];
		anchor.sourceValue = sourceValue;
		anchor.value = sourceValue;
		anchor.quranReference = reference;
		syncTranscriptText();
		activeVerseAnchorIndex = null;
		verseSelectorIsNew = false;
	}

	/**
	 * Retire les citations vides avant la validation du segment.
	 * @returns {void}
	 */
	function removeEmptyQuotations(): void {
		for (let index = transcriptDraft.anchors.length - 1; index >= 0; index--) {
			const anchor = transcriptDraft.anchors[index];
			if (anchor.type === 'citation' && !anchor.value.trim()) removeAnchor(index);
		}
	}

	/**
	 * Valide le brouillon en retirant les citations laissées vides.
	 * @returns {void}
	 */
	function submitTranscriptDraft(): void {
		removeEmptyQuotations();
		void onSubmit();
	}

	/**
	 * Gère la validation et l'annulation depuis chaque champ éditable.
	 * @param {KeyboardEvent} event Événement clavier du champ.
	 * @returns {void}
	 */
	function handleTranscriptKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			submitTranscriptDraft();
			return;
		}

		if (event.key === 'Escape' && isEditing) {
			event.preventDefault();
			onCancelEditing();
		}
	}

	/**
	 * Valide une modification quand Enter est utilisé dans l'éditeur, hors champ texte ou sélecteur Quran.
	 * @param {KeyboardEvent} event Événement clavier de l'éditeur.
	 * @returns {void}
	 */
	function handleEditorKeydown(event: KeyboardEvent): void {
		if (
			event.key !== 'Enter' ||
			!isEditing ||
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target instanceof Element && event.target.closest('[data-quran-passage-selector]'))
		) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		submitTranscriptDraft();
	}
</script>

<div
	data-structured-transcript-editor
	class="flex min-h-0 flex-1 flex-col gap-3"
	onkeydown={handleEditorKeydown}
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<label
				for="transcript-text"
				class="flex items-center gap-2 text-sm font-semibold text-primary"
			>
				<span class="material-icons text-base text-accent-primary">notes</span>
				{$LL.editor.transcriptText()}
			</label>
			<div class="flex items-center overflow-hidden rounded-lg border border-color bg-secondary">
				<button
					type="button"
					class={FONT_SIZE_BUTTON_CLASS}
					aria-label={copy.decreaseTranscriptTextSize()}
					title={copy.decreaseTranscriptTextSize()}
					disabled={transcriptFontSize <= 12}
					onclick={() => changeTranscriptFontSize(-2)}
				>
					<span class="material-icons text-base">text_decrease</span>
				</button>
				<button
					type="button"
					class={`${FONT_SIZE_BUTTON_CLASS} border-l border-color`}
					aria-label={copy.increaseTranscriptTextSize()}
					title={copy.increaseTranscriptTextSize()}
					disabled={transcriptFontSize >= 32}
					onclick={() => changeTranscriptFontSize(2)}
				>
					<span class="material-icons text-base">text_increase</span>
				</button>
			</div>
			{#if isEditing}
				<div class="ml-1 flex items-center gap-2 text-xs font-semibold text-accent-primary">
					<span class="material-icons text-sm">edit</span>
					{$LL.editor.editingTranscript()}
					<button
						type="button"
						class="cursor-pointer rounded-md border border-color bg-secondary px-2 py-1 text-xs font-semibold text-secondary transition hover:bg-accent hover:text-primary"
						onclick={onCancelEditing}
						aria-label={copy.exitEditing()}
					>
						{copy.exitEditing()}
					</button>
				</div>
			{/if}
		</div>

		<div class="flex flex-wrap items-center justify-end gap-2">
			<button
				type="button"
				class={`${INSERT_BUTTON_CLASS} border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20`}
				onclick={() => insertAnchor('quran')}
			>
				<span class="material-icons text-sm text-emerald-400">menu_book</span>
				{copy.insertVerse()}
			</button>
			<button
				type="button"
				class={`${INSERT_BUTTON_CLASS} border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20`}
				onclick={() => insertAnchor('citation')}
			>
				<span class="material-icons-outlined text-sm text-amber-400">format_quote</span>
				{copy.insertQuotation()}
			</button>

			{#if isEditing}
				<button
					type="button"
					class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-110"
					onclick={submitTranscriptDraft}
					aria-label={copy.confirmEditing()}
				>
					<span class="material-icons text-sm">check</span>
					{copy.confirmEditing()}
				</button>
			{/if}
		</div>
	</div>

	<div
		class="min-h-48 flex-1 overflow-y-auto rounded-xl border border-color bg-secondary p-3 outline-none transition focus-within:border-[var(--accent-primary)]"
	>
		<!-- Recréer les champs force Chromium à recalculer `field-sizing: content`. -->
		{#key transcriptFontSize}
			<div class="flex flex-wrap items-start gap-2" dir={transcriptDirection()}>
				{#each transcriptDraft.anchors as anchor, anchorIndex (anchor.id)}
					<TranscriptPartInput
						value={transcriptDraft.freeTexts[anchorIndex]}
						compactWhenEmpty={!transcriptDraft.freeTexts[anchorIndex]}
						inputStyle={transcriptInputStyle}
						blockStyle={transcriptBlockStyle}
						convertLabel={copy.convertToQuotation()}
						onConvert={() => convertTextToQuotation(anchorIndex)}
						onInput={(nextValue) => updateFreeText(anchorIndex, nextValue)}
						onKeydown={handleTranscriptKeydown}
					/>

					<TranscriptAnchorBlock
						{anchor}
						index={anchorIndex}
						inputStyle={transcriptInputStyle}
						blockStyle={transcriptBlockStyle}
						fontStyle={transcriptFontStyle}
						onOpenQuran={openVerseSelector}
						onUpdateQuotation={updateQuotation}
						convertQuotationToTextLabel={copy.convertQuotationToText()}
						onConvertQuotationToText={convertQuotationToText}
						onRemove={removeAnchor}
						onKeydown={handleTranscriptKeydown}
					/>
				{/each}

				<TranscriptPartInput
					id="transcript-text"
					bind:element={input}
					value={transcriptDraft.freeTexts[transcriptDraft.anchors.length]}
					compactWhenEmpty={transcriptDraft.anchors.length > 0 &&
						!transcriptDraft.freeTexts[transcriptDraft.anchors.length]}
					placeholder={transcriptDraft.anchors.length === 0
						? $LL.editor.transcriptPlaceholder()
						: ''}
					inputStyle={transcriptInputStyle}
					blockStyle={transcriptBlockStyle}
					convertLabel={copy.convertToQuotation()}
					onConvert={() => convertTextToQuotation(transcriptDraft.anchors.length)}
					onInput={(nextValue) => updateFreeText(transcriptDraft.anchors.length, nextValue)}
					onKeydown={handleTranscriptKeydown}
				/>
			</div>
		{/key}

		{#if activeQuranReference}
			<QuranPassageSelector
				reference={activeQuranReference}
				title={copy.selectQuranPassage()}
				onCancel={cancelVerseSelection}
				onApply={applyVerseSelection}
			/>
		{/if}
	</div>
</div>
