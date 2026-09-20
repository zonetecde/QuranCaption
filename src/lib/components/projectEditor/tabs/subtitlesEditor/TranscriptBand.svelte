<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		buildTranscriptBandWords,
		createTranscriptBandSelection,
		getTranscriptBandClipRange,
		type TranscriptBandSelection,
		type TranscriptBandWord
	} from '$lib/services/TranscriptBandService';
	import { tick } from 'svelte';

	type Props = {
		editedClipId: number | null;
		selectionResetKey: number;
		onSelectRange: (selection: TranscriptBandSelection) => void;
	};

	let { editedClipId, selectionResetKey, onSelectRange }: Props = $props();

	let words = $state<TranscriptBandWord[]>([]);
	let selectedRange = $state<{ startIndex: number; endIndex: number } | null>(null);
	let dragStartIndex = $state<number | null>(null);
	let isDragging = $state(false);
	let didDrag = $state(false);
	let initializedClipId = $state<number | null | undefined>(undefined);
	let initializedWords = $state<TranscriptBandWord[] | null>(null);
	let lastSelectionResetKey = $state<number | null>(null);
	let lastAutoScrolledClipId = $state<number | null>(null);
	let bandElement = $state<HTMLDivElement | null>(null);
	let wordElements = $state<(HTMLButtonElement | null)[]>([]);
	let buildRequest = 0;

	const subtitleClips = $derived(() =>
		globalState.getSubtitleTrack.clips.filter(
			(clip): clip is SubtitleClip => clip instanceof SubtitleClip
		)
	);
	const rawTranscription = $derived(
		() =>
			globalState.getSubtitlesEditorState.rawTranscription ??
			globalState.getSubtitlesEditorState.aiTranscriptCleanup?.sourceResult ??
			null
	);
	const cursorPosition = $derived(() => globalState.getTimelineState.cursorPosition);
	const activePlaybackClipId = $derived.by(() => {
		if (editedClipId !== null || !globalState.getVideoPreviewState.isPlaying) return null;
		const clip = globalState.getSubtitleTrack.getCurrentClip(cursorPosition());
		return clip instanceof SubtitleClip ? clip.id : null;
	});

	$effect(() => {
		if (selectionResetKey === lastSelectionResetKey) return;
		lastSelectionResetKey = selectionResetKey;
		selectedRange = null;
	});

	$effect(() => {
		const request = ++buildRequest;
		const clips = subtitleClips();
		void buildTranscriptBandWords(clips, rawTranscription())
			.then((nextWords) => {
				if (request !== buildRequest) return;
				words = nextWords;
				lastAutoScrolledClipId = null;
			})
			.catch(() => {
				if (request === buildRequest) {
					words = [];
					lastAutoScrolledClipId = null;
				}
			});
	});

	$effect(() => {
		const currentWords = words;
		const currentClipId = editedClipId;
		if (initializedClipId === currentClipId && initializedWords === currentWords) return;

		initializedClipId = currentClipId;
		initializedWords = currentWords;
		selectedRange = getTranscriptBandClipRange(currentWords, currentClipId);
	});

	$effect(() => {
		const clipId = activePlaybackClipId;
		if (clipId === null) {
			lastAutoScrolledClipId = null;
			return;
		}
		if (clipId === lastAutoScrolledClipId) return;
		lastAutoScrolledClipId = clipId;
		void tick().then(() => {
			centerClipWords(clipId);
		});
	});

	/**
	 * Centre visuellement le groupe de mots d'un sous-titre dans la bande.
	 *
	 * @param {number} clipId Identifiant du sous-titre à centrer.
	 * @returns {void}
	 */
	function centerClipWords(clipId: number): void {
		const range = getTranscriptBandClipRange(words, clipId);
		const firstElement = range ? wordElements[range.startIndex] : null;
		const lastElement = range ? wordElements[range.endIndex] : null;
		if (!bandElement || !firstElement || !lastElement) return;

		const bandRect = bandElement.getBoundingClientRect();
		const firstRect = firstElement.getBoundingClientRect();
		const lastRect = lastElement.getBoundingClientRect();
		const groupCenter = (firstRect.left + firstRect.right + lastRect.left + lastRect.right) / 4;
		bandElement.scrollBy({
			left: groupCenter - (bandRect.left + bandRect.right) / 2,
			behavior: 'smooth'
		});
	}

	/**
	 * Sélectionne une plage de mots après un clic ou un glissement.
	 *
	 * @param {number} startIndex Index global de départ.
	 * @param {number} endIndex Index global de fin.
	 * @returns {void}
	 */
	function selectRange(startIndex: number, endIndex: number): void {
		const normalizedStart = Math.min(startIndex, endIndex);
		const normalizedEnd = Math.max(startIndex, endIndex);
		selectedRange = { startIndex: normalizedStart, endIndex: normalizedEnd };
		onSelectRange(createTranscriptBandSelection(words, normalizedStart, normalizedEnd));
	}

	/**
	 * Applique le comportement de sélection progressive du sélecteur de mots historique.
	 *
	 * @param {number} index Index global du mot ciblé.
	 * @returns {void}
	 */
	function selectWord(index: number): void {
		if (!selectedRange) {
			selectRange(index, index);
			return;
		}

		if (index < selectedRange.startIndex) {
			selectRange(index, index);
		} else if (index > selectedRange.endIndex) {
			selectRange(selectedRange.startIndex, index);
		} else if (index === selectedRange.endIndex) {
			selectRange(index, index);
		} else {
			selectRange(selectedRange.startIndex, index);
		}
	}

	/**
	 * Démarre une sélection glissée dans le transcript.
	 *
	 * @param {MouseEvent} event Événement de la souris.
	 * @param {number} index Index global du mot pressé.
	 * @returns {void}
	 */
	function handleMouseDown(event: MouseEvent, index: number): void {
		if (event.button !== 0) return;
		event.preventDefault();
		dragStartIndex = index;
		isDragging = true;
		didDrag = false;
	}

	/**
	 * Étend la sélection pendant un glissement.
	 *
	 * @param {number} index Index global survolé.
	 * @returns {void}
	 */
	function handleMouseEnter(index: number): void {
		if (!isDragging || dragStartIndex === null) return;
		didDrag = true;
		selectRange(dragStartIndex, index);
	}

	/**
	 * Termine un glissement de sélection.
	 *
	 * @returns {void}
	 */
	function handleMouseUp(): void {
		isDragging = false;
		dragStartIndex = null;
		if (didDrag) setTimeout(() => (didDrag = false), 0);
	}

	/**
	 * Retourne la couleur de base correspondant à la nature du mot.
	 *
	 * @param {TranscriptBandWord} word Mot à afficher.
	 * @returns {string} Classes CSS de la catégorie du mot.
	 */
	function getWordClass(word: TranscriptBandWord): string {
		if (word.clipId === null) {
			return 'border-transparent text-thirdly opacity-65 hover:border-color hover:bg-accent';
		}
		if (word.kind === 'quran') {
			return 'border-transparent bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/25';
		}
		if (word.kind === 'citation') {
			return 'border-transparent bg-amber-500/10 text-amber-200 hover:bg-amber-500/25';
		}
		return 'border-transparent text-primary hover:border-color hover:bg-accent';
	}
</script>

<svelte:window onmouseup={handleMouseUp} />

<section class="min-w-0 shrink-0 space-y-2 rounded-xl border border-color bg-secondary/80 p-3">
	<div class="flex items-center gap-2 text-sm font-semibold text-primary">
		<span class="material-icons text-base text-accent-primary">notes</span>
		{$LL.editor.transcriptText()}
	</div>

	<div
		bind:this={bandElement}
		class="transcript-band min-w-0 overflow-x-auto overflow-y-hidden rounded-lg border border-color bg-primary px-3 py-2"
		dir="rtl"
		aria-label={$LL.editor.transcriptText()}
	>
		<div class="flex min-w-max flex-nowrap items-center gap-0 whitespace-nowrap py-1">
			{#each words as word (word.id)}
				{@const isSelected =
					selectedRange !== null &&
					word.globalIndex >= selectedRange.startIndex &&
					word.globalIndex <= selectedRange.endIndex}
				{@const isSelectionStart = isSelected && word.globalIndex === selectedRange?.startIndex}
				{@const isSelectionEnd = isSelected && word.globalIndex === selectedRange?.endIndex}
				{@const isPlaybackActive = word.clipId === activePlaybackClipId}
				{@const selectionBoundaryClass =
					isSelectionStart && isSelectionEnd
						? 'transcript-word-selection-single'
						: isSelectionStart
							? 'transcript-word-selection-start'
							: isSelectionEnd
								? 'transcript-word-selection-end'
								: ''}
				<button
					type="button"
					bind:this={wordElements[word.globalIndex]}
					class={`transcript-word arabic -mx-px shrink-0 rounded-md border px-2 py-1 text-lg leading-relaxed transition ${getWordClass(word)} ${isSelected ? 'transcript-word-selected' : ''} ${isSelected && word.kind === 'plain' ? 'transcript-word-selected-plain' : ''} ${isPlaybackActive ? 'transcript-word-playback-active' : ''} ${selectionBoundaryClass}`}
					onmousedown={(event) => handleMouseDown(event, word.globalIndex)}
					onmouseenter={() => handleMouseEnter(word.globalIndex)}
					onclick={() => {
						if (!didDrag) selectWord(word.globalIndex);
						didDrag = false;
					}}
					ondragstart={(event) => event.preventDefault()}
				>
					{word.text}
				</button>
			{/each}
		</div>
	</div>
</section>

<style>
	.transcript-band {
		scrollbar-color: var(--accent-primary) var(--bg-secondary);
	}

	.transcript-word {
		user-select: none;
	}

	.transcript-word-selected {
		position: relative;
		z-index: 1;
		border-top: 2px solid var(--accent-primary) !important;
		border-bottom: 2px solid var(--accent-primary) !important;
		border-inline-start: 2px solid transparent !important;
		border-inline-end: 2px solid transparent !important;
		border-radius: 0;
	}

	.transcript-word-selected-plain {
		background-color: var(--selected-word-bg) !important;
		color: var(--text-on-selected-word) !important;
	}

	.transcript-word-playback-active {
		background-color: color-mix(in srgb, var(--accent-primary) 10%, transparent) !important;
		box-shadow: inset 0 -2px var(--accent-primary);
	}

	.transcript-word-selection-start {
		border-inline-start: 2px solid var(--accent-primary) !important;
		border-start-start-radius: 12px;
		border-end-start-radius: 12px;
	}

	.transcript-word-selection-end {
		border-inline-end: 2px solid var(--accent-primary) !important;
		border-start-end-radius: 12px;
		border-end-end-radius: 12px;
	}

	.transcript-word-selection-single {
		border: 2px solid var(--accent-primary) !important;
		border-radius: 12px;
	}
</style>
