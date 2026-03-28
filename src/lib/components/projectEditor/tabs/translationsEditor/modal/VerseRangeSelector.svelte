<script lang="ts">
	let {
		totalItems,
		startIndex = $bindable(),
		endIndex = $bindable(),
		startVerseKey = 'N/A',
		endVerseKey = 'N/A',
		title = 'Verse Selection',
		icon = 'tune',
		totalLabel = 'verses found',
		selectionLabel = 'Select verse range to include in prompt:',
		selectionHint = '(in case prompt is too long)',
		onRangeChange = () => {}
	}: {
		totalItems: number;
		startIndex: number;
		endIndex: number;
		startVerseKey?: string;
		endVerseKey?: string;
		title?: string;
		icon?: string;
		totalLabel?: string;
		selectionLabel?: string;
		selectionHint?: string;
		onRangeChange?: () => void;
	} = $props();

	function handleStartInput(event: Event): void {
		const nextValue = Number((event.target as HTMLInputElement).value);
		if (nextValue > endIndex) {
			endIndex = nextValue;
		}
		startIndex = nextValue;
		onRangeChange();
	}

	function handleEndInput(event: Event): void {
		const nextValue = Number((event.target as HTMLInputElement).value);
		if (nextValue < startIndex) {
			startIndex = nextValue;
		}
		endIndex = nextValue;
		onRangeChange();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2">
		<span class="material-icons text-accent text-lg">{icon}</span>
		<h3 class="text-lg font-semibold text-primary">{title}</h3>
		<span class="bg-accent px-2 py-1 rounded-md text-xs font-semibold">
			{totalItems}
			{totalLabel}
		</span>
	</div>
	<div class="bg-accent border border-color rounded-lg p-4">
		<div class="mb-4">
			<div class="flex items-center justify-between mb-2">
				<p class="text-sm font-medium text-secondary">
					{selectionLabel}
					{#if selectionHint}
						<span class="italic">{selectionHint}</span>
					{/if}
				</p>
				<div class="text-sm text-primary font-mono">
					Indices {startIndex} to {endIndex} ({endIndex - startIndex + 1} verses)
				</div>
			</div>

			<div class="relative mt-6 mb-6">
				<div class="w-full h-2 bg-secondary rounded-full relative">
					<div
						class="absolute h-2 bg-accent-primary rounded-full"
						style="left: {(startIndex / Math.max(1, totalItems - 1)) * 100}%; width: {((endIndex -
							startIndex) /
							Math.max(1, totalItems - 1)) *
							100}%;"
					></div>
				</div>

				<input
					type="range"
					min="0"
					max={totalItems - 1}
					bind:value={startIndex}
					oninput={handleStartInput}
					class="absolute top-0 w-full h-2 appearance-none bg-transparent cursor-pointer range-slider"
				/>

				<input
					type="range"
					min="0"
					max={totalItems - 1}
					bind:value={endIndex}
					oninput={handleEndInput}
					class="absolute top-0 w-full h-2 appearance-none bg-transparent cursor-pointer range-slider"
				/>
			</div>

			<div class="grid grid-cols-2 gap-4 text-xs">
				<div class="bg-secondary border border-color rounded-lg p-3">
					<div class="font-medium text-accent-primary mb-1">Start: Index {startIndex}</div>
					<div class="text-thirdly">Verse: {startVerseKey}</div>
				</div>
				<div class="bg-secondary border border-color rounded-lg p-3">
					<div class="font-medium text-accent-primary mb-1">End: Index {endIndex}</div>
					<div class="text-thirdly">Verse: {endVerseKey}</div>
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
