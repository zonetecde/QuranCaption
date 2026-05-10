<script lang="ts">
	import type { SubtitleClip, Track } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		getSubtitleClipDurationSeconds,
		updateManualWordByWordBoundary
	} from '$lib/services/WbwHelper';
	import { onDestroy } from 'svelte';

	let { clip, track }: { clip: SubtitleClip; track: Track } = $props();

	let clipElement: HTMLDivElement | null = $state(null);
	let activeDragBoundaryIndex: number | null = $state(null);

	let positionLeft = $derived(() => (clip.startTime / 1000) * track.getPixelPerSecond());
	let clipDurationS = $derived(() => Math.max(0.001, getSubtitleClipDurationSeconds(clip)));

	type DisplayWord = {
		location: string;
		word: string;
		start: number;
		end: number;
		leftPercent: number;
		widthPercent: number;
	};

	let displayWords = $derived((): DisplayWord[] => {
		const draftWords = globalState.shared.wbwEdit.draftWords;
		if (draftWords.length === 0) return [];

		const hasMeasuredLayout = draftWords.some(
			(word, index) => word.end > word.start || (index > 0 && word.start > 0)
		);
		return draftWords.map((word, index) => {
			const fallbackStart = (index / draftWords.length) * clipDurationS();
			const fallbackEnd = ((index + 1) / draftWords.length) * clipDurationS();
			const start = hasMeasuredLayout ? word.start : fallbackStart;
			const end = hasMeasuredLayout ? Math.max(word.start, word.end) : fallbackEnd;
			const leftPercent = (start / clipDurationS()) * 100;
			const widthPercent = Math.max(1, ((Math.max(start, end) - start) / clipDurationS()) * 100);

			return {
				location: word.location,
				word: word.word,
				start,
				end,
				leftPercent,
				widthPercent
			};
		});
	});

	/**
	 * Commence le drag d'une borne interieure entre deux mots.
	 *
	 * @param {number} boundaryIndex Index de la borne a deplacer.
	 * @param {MouseEvent} event Evenement d'origine.
	 * @returns {void}
	 */
	function startBoundaryDragging(boundaryIndex: number, event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		activeDragBoundaryIndex = boundaryIndex;
		globalState.shared.wbwEdit.dragBoundaryIndex = boundaryIndex;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('mousemove', handleBoundaryDragging);
		document.addEventListener('mouseup', stopBoundaryDragging);
	}

	/**
	 * Deplace la borne active en fonction de la position souris dans le clip.
	 *
	 * @param {MouseEvent} event Evenement souris global.
	 * @returns {void}
	 */
	function handleBoundaryDragging(event: MouseEvent): void {
		if (activeDragBoundaryIndex === null || !clipElement) return;

		const rect = clipElement.getBoundingClientRect();
		if (rect.width <= 0) return;

		const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
		updateManualWordByWordBoundary(activeDragBoundaryIndex, (x / rect.width) * clipDurationS());
	}

	/**
	 * Termine le drag courant d'une borne WBW.
	 *
	 * @returns {void}
	 */
	function stopBoundaryDragging(): void {
		activeDragBoundaryIndex = null;
		globalState.shared.wbwEdit.dragBoundaryIndex = null;
		globalState.getTimelineState.showCursor = true;
		document.removeEventListener('mousemove', handleBoundaryDragging);
		document.removeEventListener('mouseup', stopBoundaryDragging);
	}

	onDestroy(() => {
		stopBoundaryDragging();
	});
</script>

<div
	bind:this={clipElement}
	class="absolute inset-0 z-20 rounded-md border border-yellow-400/80 bg-yellow-500/8 overflow-hidden wbw-edit-clip"
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
>
	<div class="absolute inset-0 flex items-stretch">
		{#each displayWords() as word, index (word.location)}
			<button
				class="absolute top-0 bottom-0 wbw-edit-word cursor-pointer"
				class:wbw-edit-word-active={index === globalState.shared.wbwEdit.currentWordIndex}
				style={`left: ${word.leftPercent}%; width: ${word.widthPercent}%;`}
				title={word.word}
				onclick={() => {
					globalState.shared.wbwEdit.currentWordIndex = index;
				}}
			>
				<span class="wbw-edit-word-text arabic">{word.word}</span>
			</button>
		{/each}
	</div>

	{#each displayWords().slice(0, -1) as word, index (word.location)}
		<button
			class="absolute top-0 bottom-0 z-30 w-2 -ml-1 cursor-col-resize wbw-edit-boundary"
			style={`left: ${((word.end / clipDurationS()) * 100).toFixed(4)}%;`}
			title="Drag word boundary"
			onmousedown={(event) => startBoundaryDragging(index, event)}
		>
			<span class="wbw-edit-boundary-line"></span>
		</button>
	{/each}
</div>

<style>
	.wbw-edit-clip {
		box-shadow: inset 0 0 0 1px rgb(250 204 21 / 0.28);
	}

	.wbw-edit-word {
		border-right: 1px solid rgb(255 255 255 / 0.08);
		background: rgb(250 204 21 / 0.12);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		overflow: hidden;
	}

	.wbw-edit-word:hover {
		background: rgb(250 204 21 / 0.18);
	}

	.wbw-edit-word-active {
		background: rgb(250 204 21 / 0.34);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18);
	}

	.wbw-edit-word-active:hover {
		background: rgb(250 204 21 / 0.34);
	}

	.wbw-edit-word-text {
		font-size: 0.9rem;
		line-height: 1.1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	.wbw-edit-boundary {
		background: transparent;
		border: 0;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.wbw-edit-boundary-line {
		height: 84%;
		width: 1px;
		background: rgb(255 255 255 / 0.62);
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.1);
	}

	.wbw-edit-boundary:hover .wbw-edit-boundary-line {
		background: rgb(255 255 255 / 0.92);
	}
</style>
