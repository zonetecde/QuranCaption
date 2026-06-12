<script lang="ts">
	import { onMount } from 'svelte';

	type TranslationWordSelectorItem = {
		text: string;
		wordIndex: number;
		style?: string;
	};

	let {
		words,
		isWordSelected = () => false,
		onSelection
	}: {
		words: TranslationWordSelectorItem[];
		isWordSelected?: (wordIndex: number) => boolean;
		onSelection: (startWordIndex: number, endWordIndex: number) => void;
	} = $props();

	let isDragging = $state(false);
	let dragStartIndex = $state(-1);
	let selectionStart = $state(-1);
	let selectionEnd = $state(-1);

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
	 * Démarre une sélection à la souris.
	 *
	 * @param {number} wordIndex Index du mot cliqué.
	 * @param {MouseEvent} event Événement souris source.
	 * @returns {void}
	 */
	function handleMouseDown(wordIndex: number, event: MouseEvent): void {
		event.preventDefault();
		isDragging = true;
		dragStartIndex = wordIndex;
		selectionStart = wordIndex;
		selectionEnd = wordIndex;
	}

	/**
	 * Étend la sélection pendant le survol.
	 *
	 * @param {number} wordIndex Index du mot survolé.
	 * @returns {void}
	 */
	function handleMouseEnter(wordIndex: number): void {
		if (!isDragging) return;

		selectionStart = Math.min(dragStartIndex, wordIndex);
		selectionEnd = Math.max(dragStartIndex, wordIndex);
	}

	/**
	 * Termine le drag et transmet la plage sélectionnée.
	 *
	 * @returns {void}
	 */
	function finishSelection(): void {
		if (!isDragging || selectionStart === -1 || selectionEnd === -1) {
			resetSelection();
			return;
		}

		onSelection(selectionStart, selectionEnd);
		resetSelection();
	}

	onMount(() => {
		window.addEventListener('mouseup', finishSelection);

		return () => {
			window.removeEventListener('mouseup', finishSelection);
		};
	});
</script>

<div
	class="translation-style-flow select-none"
	onmouseup={finishSelection}
	onmouseleave={finishSelection}
	role="presentation"
>
	{#each words as word (`${word.wordIndex}-${word.text}`)}
		{@const isSelected = isDragSelected(word.wordIndex) || isWordSelected(word.wordIndex)}
		<button
			class={`translation-word-style text-sm transition-all duration-150 ${
				isSelected ? 'translation-word-style-selected text-primary shadow-sm' : 'text-primary'
			}`}
			style={word.style ?? ''}
			onmousedown={(event) => handleMouseDown(word.wordIndex, event)}
			onmouseenter={() => handleMouseEnter(word.wordIndex)}
			ondragstart={(event) => event.preventDefault()}
		>
			{word.text}
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
</style>
