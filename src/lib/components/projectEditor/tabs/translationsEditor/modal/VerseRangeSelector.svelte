<script lang="ts">
	import { Duration } from '$lib/classes';
	import { VerseRange } from '$lib/classes/VerseRange.svelte';

	let {
		totalDurationMs,
		totalItems,
		selectedItems = 0,
		startTimeMs = $bindable(),
		endTimeMs = $bindable(),
		title = 'Time Selection',
		icon = 'schedule',
		totalLabel = 'eligible verses',
		selectionLabel = 'Select time range to include:',
		selectionHint = '(based on the video timeline)',
		onRangeChange = () => {}
	}: {
		totalDurationMs: number;
		totalItems: number;
		selectedItems?: number;
		startTimeMs: number;
		endTimeMs: number;
		title?: string;
		icon?: string;
		totalLabel?: string;
		selectionLabel?: string;
		selectionHint?: string;
		onRangeChange?: () => void;
	} = $props();

	const SLIDER_STEP_MS = 1000;

	const maxDurationMs = $derived(Math.max(totalDurationMs, 1));
	const selectedVerseRange = $derived(VerseRange.getVerseRange(startTimeMs, endTimeMs));

	function formatTime(ms: number): string {
		return new Duration(Math.max(0, ms)).getFormattedTime(false, true);
	}

	function handleStartInput(event: Event): void {
		const nextValue = Number((event.target as HTMLInputElement).value);
		if (nextValue > endTimeMs) {
			endTimeMs = nextValue;
		}
		startTimeMs = nextValue;
		onRangeChange();
	}

	function handleEndInput(event: Event): void {
		const nextValue = Number((event.target as HTMLInputElement).value);
		if (nextValue < startTimeMs) {
			startTimeMs = nextValue;
		}
		endTimeMs = nextValue;
		onRangeChange();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2">
		<span class="material-icons text-accent text-lg">{icon}</span>
		<h3 class="text-lg font-semibold text-primary">{title}</h3>
		<span class="rounded-md bg-accent px-2 py-1 text-xs font-semibold">
			{totalItems}
			{totalLabel}
		</span>
		<span
			class="rounded-md border border-color bg-secondary px-2 py-1 text-xs font-semibold text-primary"
		>
			{selectedItems} selected
		</span>
	</div>
	<div class="rounded-lg border border-color bg-accent p-4">
		<div class="mb-4">
			<div class="mb-2 flex items-center justify-between gap-4">
				<p class="text-sm font-medium text-secondary">
					{selectionLabel}
					{#if selectionHint}
						<span class="italic">{selectionHint}</span>
					{/if}
				</p>
				<div class="text-sm font-mono text-primary">
					{formatTime(startTimeMs)} to {formatTime(endTimeMs)}
				</div>
			</div>

			<div class="relative mb-6 mt-6">
				<div class="relative h-2 w-full rounded-full bg-secondary">
					<div
						class="absolute h-2 rounded-full bg-accent-primary"
						style="left: {(startTimeMs / Math.max(1, maxDurationMs)) * 100}%; width: {((endTimeMs -
							startTimeMs) /
							Math.max(1, maxDurationMs)) *
							100}%;"
					></div>
				</div>

				<input
					type="range"
					min="0"
					max={maxDurationMs}
					step={SLIDER_STEP_MS}
					bind:value={startTimeMs}
					oninput={handleStartInput}
					class="range-slider absolute top-0 h-2 w-full appearance-none bg-transparent cursor-pointer"
				/>

				<input
					type="range"
					min="0"
					max={maxDurationMs}
					step={SLIDER_STEP_MS}
					bind:value={endTimeMs}
					oninput={handleEndInput}
					class="range-slider absolute top-0 h-2 w-full appearance-none bg-transparent cursor-pointer"
				/>
			</div>

			<div class="grid gap-4 md:grid-cols-2">
				<div class="rounded-lg border border-color bg-secondary p-3 text-xs">
					<div class="mb-1 font-medium text-accent-primary">Start time</div>
					<div class="font-mono text-primary">{formatTime(startTimeMs)}</div>
				</div>
				<div class="rounded-lg border border-color bg-secondary p-3 text-xs">
					<div class="mb-1 font-medium text-accent-primary">End time</div>
					<div class="font-mono text-primary">{formatTime(endTimeMs)}</div>
				</div>
				<div class="rounded-lg border border-color bg-secondary p-3 text-xs md:col-span-2">
					<div class="mb-1 font-medium text-accent-primary">Verse range on video</div>
					<div class="text-secondary">
						{selectedVerseRange.toString()}
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.range-slider {
		pointer-events: none;
	}

	.range-slider::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent-primary);
		border: 3px solid var(--bg-primary);
		cursor: pointer;
		pointer-events: all;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		transition: all 0.2s ease;
		position: relative;
		z-index: 2;
	}

	.range-slider::-webkit-slider-thumb:hover {
		transform: scale(1.1);
		box-shadow: 0 3px 8px rgba(88, 166, 255, 0.4);
	}

	.range-slider::-webkit-slider-thumb:active {
		transform: scale(1.05);
		box-shadow: 0 1px 4px rgba(88, 166, 255, 0.6);
	}

	.range-slider::-moz-range-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent-primary);
		border: 3px solid var(--bg-primary);
		cursor: pointer;
		pointer-events: all;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		transition: all 0.2s ease;
	}

	.range-slider::-moz-range-thumb:hover {
		transform: scale(1.1);
		box-shadow: 0 3px 8px rgba(88, 166, 255, 0.4);
	}

	.range-slider::-moz-range-track {
		background: transparent;
		height: 8px;
	}

	.range-slider:focus {
		outline: none;
	}

	.range-slider:focus::-webkit-slider-thumb {
		box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.3);
	}
</style>
