<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { closePublishForm, openPublishForm } from '../actions/publishActions';

	let { onBack }: { onBack: () => void } = $props();

	let publishMode = $derived(globalState.presetLibrary.publishMode);
</script>

<div class="flex items-center gap-3 border-b border-color px-4 py-3">
	<button
		class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-primary hover:text-primary"
		type="button"
		onclick={() => (publishMode ? closePublishForm() : onBack())}
		aria-label={publishMode ? $LL.style.backToStylePresets() : $LL.style.backToStyleEditor()}
	>
		<span class="material-icons-outlined text-lg">arrow_back</span>
	</button>
	<div class="min-w-0 flex-1">
		<h2 class="truncate text-lg font-semibold text-primary">
			{publishMode ? $LL.style.publishPresetHeading() : $LL.style.stylePresets()}
		</h2>
		<p class="text-xs text-secondary">
			{publishMode ? $LL.style.publishPresetSubtitle() : $LL.style.presetsSubtitle()}
		</p>
	</div>
	{#if !publishMode}
		<div class="flex items-center gap-2">
			<button
				class="btn-accent flex h-9 items-center gap-2 px-3 text-sm font-medium"
				type="button"
				onclick={openPublishForm}
			>
				<span class="material-icons-outlined text-base">public</span>
				{$LL.style.publishPreset()}
			</button>
			<button
				class="btn-accent flex h-9 items-center gap-2 px-3 text-sm font-medium"
				type="button"
				onclick={() => (globalState.presetLibrary.modalMode = 'save')}
			>
				<span class="material-icons-outlined text-base">add</span>
				{$LL.style.saveLocally()}
			</button>
		</div>
	{/if}
</div>
