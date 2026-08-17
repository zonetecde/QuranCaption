<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { getVerseRangeSliderIndexes, type VerseRangeSliderOption } from './VerseRangeSlider';

	type VerseOption = {
		key: string;
		surah: number;
		startTime?: number;
		endTime?: number;
	};

	type SurahSegment = {
		start: number;
		end: number;
		color: string;
	};

	let {
		verses,
		startIndex = $bindable(0),
		endIndex = $bindable(0),
		startTimeMs = $bindable(),
		endTimeMs = $bindable(),
		startLabel = $LL.aiVideo.fromAyah(),
		endLabel = $LL.aiVideo.toAyah(),
		onStartInput = () => {},
		onEndInput = () => {},
		onDragStart = () => {},
		onDragEnd = () => {},
		onRangeChange = () => {},
		title,
		icon = 'format_list_numbered',
		totalItems,
		selectedItems,
		totalLabel = $LL.editor.eligibleVerses(),
		selectionLabel,
		selectionHint = '',
		showRangeLabel = false
	}: {
		verses: VerseOption[];
		startIndex?: number;
		endIndex?: number;
		startTimeMs?: number;
		endTimeMs?: number;
		startLabel?: string;
		endLabel?: string;
		onStartInput?: (index: number) => void;
		onEndInput?: (index: number) => void;
		onDragStart?: () => void;
		onDragEnd?: () => void;
		onRangeChange?: () => void | Promise<void>;
		title?: string;
		icon?: string;
		totalItems?: number;
		selectedItems?: number;
		totalLabel?: string;
		selectionLabel?: string;
		selectionHint?: string;
		showRangeLabel?: boolean;
	} = $props();

	let rail: HTMLDivElement;
	let activeBoundary: 'start' | 'end' | null = null;
	const lastIndex = $derived(Math.max(0, verses.length - 1));
	const denominator = $derived(Math.max(1, lastIndex));
	const startPosition = $derived((startIndex / denominator) * 100);
	const endPosition = $derived((endIndex / denominator) * 100);
	const selectionStart = $derived(startPosition);
	const selectionEnd = $derived(endPosition);
	const selectedRangeLabel = $derived(
		verses.length > 0 ? `${verses[startIndex]?.key} – ${verses[endIndex]?.key}` : ''
	);
	const segments = $derived.by(() => {
		const result: SurahSegment[] = [];
		const surahs = [...new Set(verses.map((verse) => verse.surah))];

		for (let index = 0; index < verses.length; index += 1) {
			const previous = result.at(-1);
			const surah = verses[index].surah;
			const colorIndex = surahs.indexOf(surah);
			const color = `hsl(${(colorIndex * 137.508) % 360} 72% 55%)`;

			if (index > 0 && verses[index - 1].surah === surah && previous) {
				previous.end = index === lastIndex ? 100 : ((index + 0.5) / denominator) * 100;
				continue;
			}

			result.push({
				start: index === 0 ? 0 : ((index - 0.5) / denominator) * 100,
				end: index === lastIndex ? 100 : ((index + 0.5) / denominator) * 100,
				color
			});
		}

		return result;
	});

	$effect(() => {
		if (
			activeBoundary ||
			startTimeMs === undefined ||
			endTimeMs === undefined ||
			!hasTimedVerses(verses)
		) {
			return;
		}

		const indexes = getVerseRangeSliderIndexes(verses, startTimeMs, endTimeMs);
		startIndex = indexes.start;
		endIndex = indexes.end;
	});

	/**
	 * Vérifie que chaque verset possède des bornes temporelles.
	 *
	 * @param {VerseOption[]} options Versets à vérifier.
	 * @returns {boolean} `true` lorsque toutes les bornes sont disponibles.
	 */
	function hasTimedVerses(options: VerseOption[]): options is VerseRangeSliderOption[] {
		return options.every(
			(option) => typeof option.startTime === 'number' && typeof option.endTime === 'number'
		);
	}

	/**
	 * Convertit une position horizontale en index de verset.
	 * @param {number} clientX Position horizontale du pointeur.
	 * @returns {number} Index de verset borné.
	 */
	function getIndexAtPosition(clientX: number): number {
		const bounds = rail.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
		return Math.round(ratio * lastIndex);
	}

	/**
	 * Met à jour la borne actuellement déplacée.
	 * @param {number} clientX Position horizontale du pointeur.
	 * @returns {void}
	 */
	function updateActiveBoundary(clientX: number): void {
		const index = getIndexAtPosition(clientX);
		if (activeBoundary === 'start') applyStartIndex(Math.min(index, endIndex));
		if (activeBoundary === 'end') applyEndIndex(Math.max(index, startIndex));
	}

	/**
	 * Applique la borne de début et synchronise son timestamp éventuel.
	 *
	 * @param {number} index Index de début demandé.
	 * @returns {void}
	 */
	function applyStartIndex(index: number): void {
		startIndex = Math.max(0, Math.min(index, endIndex));
		if (typeof verses[startIndex]?.startTime === 'number') {
			startTimeMs = verses[startIndex].startTime;
		}
		onStartInput(startIndex);
		void onRangeChange();
	}

	/**
	 * Applique la borne de fin et synchronise son timestamp éventuel.
	 *
	 * @param {number} index Index de fin demandé.
	 * @returns {void}
	 */
	function applyEndIndex(index: number): void {
		endIndex = Math.min(lastIndex, Math.max(index, startIndex));
		if (typeof verses[endIndex]?.endTime === 'number') {
			endTimeMs = verses[endIndex].endTime;
		}
		onEndInput(endIndex);
		void onRangeChange();
	}

	/**
	 * Commence le déplacement d'une poignée ou choisit la poignée la plus proche du rail.
	 * @param {PointerEvent} event Événement du pointeur.
	 * @returns {void}
	 */
	function handlePointerDown(event: PointerEvent): void {
		const boundary = (event.target as HTMLElement).closest<HTMLElement>('[data-boundary]')?.dataset
			.boundary;
		const index = getIndexAtPosition(event.clientX);
		activeBoundary =
			boundary === 'start' || boundary === 'end'
				? boundary
				: Math.abs(index - startIndex) <= Math.abs(index - endIndex)
					? 'start'
					: 'end';
		rail.setPointerCapture(event.pointerId);
		onDragStart();
		updateActiveBoundary(event.clientX);
		event.preventDefault();
	}

	/**
	 * Continue le déplacement de la poignée active.
	 * @param {PointerEvent} event Événement du pointeur.
	 * @returns {void}
	 */
	function handlePointerMove(event: PointerEvent): void {
		if (!activeBoundary) return;
		updateActiveBoundary(event.clientX);
	}

	/**
	 * Termine le déplacement en cours.
	 * @returns {void}
	 */
	function handlePointerUp(): void {
		if (!activeBoundary) return;
		activeBoundary = null;
		onDragEnd();
	}

	/**
	 * Déplace une poignée au clavier.
	 * @param {'start' | 'end'} boundary Poignée à déplacer.
	 * @param {KeyboardEvent} event Événement clavier.
	 * @returns {void}
	 */
	function handleKeyDown(boundary: 'start' | 'end', event: KeyboardEvent): void {
		const current = boundary === 'start' ? startIndex : endIndex;
		let next = current;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1;
		else if (event.key === 'Home') next = boundary === 'start' ? 0 : startIndex;
		else if (event.key === 'End') next = boundary === 'start' ? endIndex : lastIndex;
		else return;

		event.preventDefault();
		if (boundary === 'start') applyStartIndex(Math.max(0, Math.min(next, endIndex)));
		else applyEndIndex(Math.min(lastIndex, Math.max(next, startIndex)));
	}
</script>

<div class={title ? 'space-y-3' : ''}>
	{#if title}
		<div class="flex items-center gap-2">
			<span class="material-icons text-accent text-lg">{icon}</span>
			<h3 class="text-lg font-semibold text-primary">{title}</h3>
			{#if totalItems !== undefined}
				<span class="rounded-md bg-accent px-2 py-1 text-xs font-semibold">
					{totalItems}
					{totalLabel}
				</span>
			{/if}
			{#if selectedItems !== undefined}
				<span
					class="rounded-md border border-color bg-secondary px-2 py-1 text-xs font-semibold text-primary"
				>
					{$LL.editor.selectedItems({ count: selectedItems })}
				</span>
			{/if}
		</div>
	{/if}

	<div class={title ? 'rounded-lg border border-color bg-accent p-4' : ''}>
		{#if selectionLabel || selectionHint}
			<p class="mb-4 text-sm font-medium text-secondary">
				{selectionLabel}
				{#if selectionHint}<span class="italic"> {selectionHint}</span>{/if}
			</p>
		{/if}
		{#if showRangeLabel}
			<div class="mb-5 text-center font-mono text-sm font-medium text-accent-primary">
				{selectedRangeLabel}
			</div>
		{/if}

		<div
			bind:this={rail}
			class="relative h-3 w-full touch-none cursor-pointer select-none rounded-full"
			role="presentation"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		>
			<div class="absolute inset-0 overflow-hidden rounded-full bg-primary">
				{#each segments as segment}
					{@const selectedStart = Math.max(segment.start, selectionStart)}
					{@const selectedEnd = Math.min(segment.end, selectionEnd)}
					{#if selectedEnd > selectedStart}
						<div
							class="absolute inset-y-0"
							style="left: {selectedStart}%; width: {selectedEnd -
								selectedStart}%; background: {segment.color};"
						></div>
					{/if}
				{/each}
			</div>

			<button
				type="button"
				data-boundary="end"
				class="absolute top-1/2 z-10 h-6 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-primary)] bg-[var(--accent-primary)] shadow-md outline-none transition-transform hover:scale-110 focus:ring-2 focus:ring-[var(--accent-primary)]"
				style="left: {endPosition}%"
				role="slider"
				aria-label={endLabel}
				aria-valuemin={startIndex}
				aria-valuemax={lastIndex}
				aria-valuenow={endIndex}
				aria-valuetext={verses[endIndex]?.key}
				onkeydown={(event) => handleKeyDown('end', event)}
			></button>
			<button
				type="button"
				data-boundary="start"
				class="absolute top-1/2 z-20 h-6 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-primary)] bg-[var(--accent-primary)] shadow-md outline-none transition-transform hover:scale-110 focus:ring-2 focus:ring-[var(--accent-primary)]"
				style="left: {startPosition}%"
				role="slider"
				aria-label={startLabel}
				aria-valuemin="0"
				aria-valuemax={endIndex}
				aria-valuenow={startIndex}
				aria-valuetext={verses[startIndex]?.key}
				onkeydown={(event) => handleKeyDown('start', event)}
			></button>
		</div>
	</div>
</div>
