<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { closePublishForm } from '../actions/publishActions';

	let { onBack }: { onBack: () => void } = $props();

	let publishMode = $derived(globalState.presetLibrary.publishMode);
</script>

<div class="flex min-w-0 items-center gap-2 border-b border-color px-3 py-2.5">
	<button
		class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-primary hover:text-primary"
		type="button"
		onclick={() => (publishMode ? closePublishForm() : onBack())}
		aria-label={publishMode ? $LL.style.backToStylePresets() : $LL.style.backToStyleEditor()}
	>
		<span class="material-icons-outlined text-lg">arrow_back</span>
	</button>
	<h2 class="min-w-0 flex-1 truncate text-base font-semibold text-primary">
		{publishMode ? $LL.style.publishPresetHeading() : $LL.style.stylePresets()}
	</h2>
</div>
