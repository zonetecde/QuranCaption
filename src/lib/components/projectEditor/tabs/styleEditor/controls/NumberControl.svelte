<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: ApplyStyleControlValue } = $props();
</script>

<div class="flex items-center gap-x-2">
	<input
		class="w-full accent-accent"
		type="range"
		min={style.valueMin}
		max={style.valueMax}
		step={style.step || 1}
		{value}
		onpointerdown={() => ProjectHistoryManager.begin('adjust style slider')}
		onpointerup={() => ProjectHistoryManager.commit()}
		onblur={() => ProjectHistoryManager.commit()}
		oninput={(event) => onChange((event.target as HTMLInputElement).value)}
	/>
	<input
		type="number"
		min={style.valueMin}
		max={style.valueMax}
		step={style.step || 1}
		{value}
		oninput={(event) => onChange((event.target as HTMLInputElement).value)}
		class="w-20"
	/>
</div>
