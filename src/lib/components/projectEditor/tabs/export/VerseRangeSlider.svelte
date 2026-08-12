<script lang="ts">
	type VerseOption = {
		key: string;
		surah: number;
	};

	type SurahSegment = {
		start: number;
		end: number;
		color: string;
	};

	let {
		verses,
		startIndex,
		endIndex,
		startLabel,
		endLabel,
		onStartInput,
		onEndInput,
		onDragStart,
		onDragEnd
	}: {
		verses: VerseOption[];
		startIndex: number;
		endIndex: number;
		startLabel: string;
		endLabel: string;
		onStartInput: (index: number) => void;
		onEndInput: (index: number) => void;
		onDragStart: () => void;
		onDragEnd: () => void;
	} = $props();

	let rail: HTMLDivElement;
	let activeBoundary: 'start' | 'end' | null = null;
	const lastIndex = $derived(Math.max(0, verses.length - 1));
	const denominator = $derived(Math.max(1, lastIndex));
	const startPosition = $derived((startIndex / denominator) * 100);
	const endPosition = $derived((endIndex / denominator) * 100);
	const selectionStart = $derived(startIndex === 0 ? 0 : ((startIndex - 0.5) / denominator) * 100);
	const selectionEnd = $derived(
		endIndex === lastIndex ? 100 : ((endIndex + 0.5) / denominator) * 100
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
		if (activeBoundary === 'start') onStartInput(Math.min(index, endIndex));
		if (activeBoundary === 'end') onEndInput(Math.max(index, startIndex));
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
		if (boundary === 'start') onStartInput(Math.max(0, Math.min(next, endIndex)));
		else onEndInput(Math.min(lastIndex, Math.max(next, startIndex)));
	}
</script>

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
			<div
				class="absolute inset-y-0 opacity-30"
				style="left: {segment.start}%; width: {segment.end -
					segment.start}%; background: {segment.color};"
			></div>
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
