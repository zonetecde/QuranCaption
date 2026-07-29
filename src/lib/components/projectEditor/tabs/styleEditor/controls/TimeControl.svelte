<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { msToTimeValue } from './utils';

	let {
		value,
		onChange,
		onUsePreviewCursor
	}: {
		value: StyleControlValue;
		onChange: ApplyStyleControlValue;
		onUsePreviewCursor: (cursorMs: number) => void;
	} = $props();

	/**
	 * Convertit puis applique la valeur de l'input temporel.
	 * @param {string} nextValue Temps au format HH:mm:ss.
	 * @returns {void}
	 */
	function applyTimeInput(nextValue: string): void {
		const [hours, minutes, seconds] = nextValue.split(':').map(Number);
		onChange((hours * 3600 + minutes * 60 + seconds) * 1000);
	}

	/**
	 * Applique la position courante de la preview.
	 * @returns {void}
	 */
	function applyPreviewCursor(): void {
		const cursorMs = globalState.getTimelineState.cursorPosition;
		onChange(cursorMs);
		onUsePreviewCursor(cursorMs);
	}
</script>

<div class="relative flex flex-row items-center gap-x-2">
	<input
		type="time"
		class="w-full"
		oninput={(event) => applyTimeInput((event.target as HTMLInputElement).value)}
		value={msToTimeValue(Number(value))}
	/>
	<span>{$LL.export.orText()}</span>
	<button
		class="btn-accent min-w-[150px] py-1 text-sm"
		title={$LL.editor.usePreviewCursorTime()}
		onclick={applyPreviewCursor}
	>
		{$LL.editor.usePreviewCursorTime()}
	</button>
</div>
