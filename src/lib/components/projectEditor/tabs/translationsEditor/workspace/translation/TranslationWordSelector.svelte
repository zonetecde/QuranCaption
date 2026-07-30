<script lang="ts">
	type TranslationWordSelectorItem = {
		text: string;
		wordIndex: number;
		lineBreak?: boolean;
		style?: string;
	};

	let {
		words,
		direction = 'ltr',
		isWordSelected = () => false,
		showHoverEffect = true,
		onSelection
	}: {
		words: TranslationWordSelectorItem[];
		direction?: 'ltr' | 'rtl';
		isWordSelected?: (wordIndex: number) => boolean;
		showHoverEffect?: boolean;
		onSelection: (startWordIndex: number, endWordIndex: number) => void;
	} = $props();

	let isDragging = $state(false);
	let dragStartIndex = $state(-1);
	let selectionStart = $state(-1);
	let selectionEnd = $state(-1);
	let activePointerId: number | null = null;
	let selectorElement: HTMLElement | null = $state(null);

	const POINTER_TOLERANCE_PX = 24;

	/**
	 * Réinitialise la sélection temporaire.
	 *
	 * @returns {void}
	 */
	function resetSelection(): void {
		isDragging = false;
		dragStartIndex = -1;
		selectionStart = -1;
		selectionEnd = -1;
		activePointerId = null;
	}

	/**
	 * Indique si un mot est dans la sélection temporaire.
	 *
	 * @param {number} wordIndex Index du mot.
	 * @returns {boolean} `true` si le mot est sélectionné pendant le drag.
	 */
	function isDragSelected(wordIndex: number): boolean {
		return selectionStart !== -1 && selectionStart <= wordIndex && wordIndex <= selectionEnd;
	}

	/**
	 * Retourne le mot sous le pointeur, ou le plus proche dans la zone du sélecteur.
	 *
	 * @param {number} clientX Position horizontale du pointeur.
	 * @param {number} clientY Position verticale du pointeur.
	 * @returns {number | null} Index du mot trouvé, sinon `null`.
	 */
	function getWordIndexAtPoint(clientX: number, clientY: number): number | null {
		if (!selectorElement) return null;

		const selectorRect = selectorElement.getBoundingClientRect();
		if (
			clientX < selectorRect.left - POINTER_TOLERANCE_PX ||
			clientX > selectorRect.right + POINTER_TOLERANCE_PX ||
			clientY < selectorRect.top - POINTER_TOLERANCE_PX ||
			clientY > selectorRect.bottom + POINTER_TOLERANCE_PX
		) {
			return null;
		}

		let closestWordIndex: number | null = null;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const wordElement of selectorElement.querySelectorAll<HTMLElement>(
			'[data-translation-style-word-index]'
		)) {
			const rect = wordElement.getBoundingClientRect();
			const deltaX = Math.max(rect.left - clientX, 0, clientX - rect.right);
			const deltaY = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
			const distance = deltaX * deltaX + deltaY * deltaY;
			if (distance >= closestDistance) continue;

			const wordIndex = Number(wordElement.dataset.translationStyleWordIndex);
			if (!Number.isInteger(wordIndex)) continue;
			closestDistance = distance;
			closestWordIndex = wordIndex;
		}

		return closestWordIndex;
	}

	/**
	 * Démarre une sélection tactile ou souris.
	 *
	 * @param {number} wordIndex Index du mot cliqué.
	 * @param {PointerEvent} event Événement pointeur source.
	 * @returns {void}
	 */
	function handlePointerDown(wordIndex: number, event: PointerEvent): void {
		if (activePointerId !== null || event.button !== 0) return;
		event.preventDefault();
		selectorElement?.setPointerCapture(event.pointerId);
		isDragging = true;
		dragStartIndex = wordIndex;
		selectionStart = wordIndex;
		selectionEnd = wordIndex;
		activePointerId = event.pointerId;
	}

	/**
	 * Étend la sélection jusqu'au mot actuellement sous le pointeur.
	 *
	 * @param {PointerEvent} event Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function handlePointerMove(event: PointerEvent): void {
		if (!isDragging || event.pointerId !== activePointerId) return;
		if (event.cancelable) event.preventDefault();

		const wordIndex = getWordIndexAtPoint(event.clientX, event.clientY);
		if (wordIndex === null) return;
		selectionStart = Math.min(dragStartIndex, wordIndex);
		selectionEnd = Math.max(dragStartIndex, wordIndex);
	}

	/**
	 * Termine le drag et transmet la plage sélectionnée.
	 *
	 * @param {PointerEvent} event Événement de fin du pointeur.
	 * @returns {void}
	 */
	function finishSelection(event: PointerEvent): void {
		if (event.pointerId !== activePointerId) return;
		if (!isDragging || selectionStart === -1 || selectionEnd === -1) {
			resetSelection();
			return;
		}

		onSelection(selectionStart, selectionEnd);
		resetSelection();
	}

	/**
	 * Annule proprement un geste interrompu par le système.
	 *
	 * @param {PointerEvent} event Événement d'annulation du pointeur.
	 * @returns {void}
	 */
	function cancelSelection(event: PointerEvent): void {
		if (event.pointerId === activePointerId) resetSelection();
	}
</script>

<svelte:window
	onpointermove={handlePointerMove}
	onpointerup={finishSelection}
	onpointercancel={cancelSelection}
/>

<div
	class="translation-style-flow select-none touch-none"
	dir={direction}
	bind:this={selectorElement}
	role="presentation"
>
	{#each words as word (`${word.wordIndex}-${word.text}`)}
		{@const isSelected = isDragSelected(word.wordIndex) || isWordSelected(word.wordIndex)}
		<button
			class={`translation-word-style touch-none text-sm transition-all duration-150 ${showHoverEffect ? 'translation-word-style-hoverable' : ''} ${
				isSelected ? 'translation-word-style-selected text-primary shadow-sm' : 'text-primary'
			}`}
			style={word.style ?? ''}
			data-translation-style-word-index={word.wordIndex}
			onpointerdown={(event) => handlePointerDown(word.wordIndex, event)}
			ondragstart={(event) => event.preventDefault()}
		>
			{word.text}
			{#if word.lineBreak}
				<span class="material-icons translation-word-line-break" aria-hidden="true">
					keyboard_return
				</span>
			{/if}
		</button>
	{/each}
</div>

<style>
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

	.translation-word-line-break {
		margin-left: 0.1em;
		font-size: 0.95em;
		line-height: 0;
		vertical-align: -0.16em;
		color: var(--accent-primary);
	}

	.translation-style-flow {
		font-size: 0.95rem;
		line-height: 1.7;
		color: var(--text-primary);
		cursor: text;
		touch-action: none;
	}

	.translation-word-style-hoverable:hover {
		background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
	}

	.translation-word-style-selected {
		background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
	}

	.translation-word-style-hoverable.translation-word-style-selected:hover {
		background: color-mix(in srgb, var(--accent-primary) 66%, transparent);
	}
</style>
