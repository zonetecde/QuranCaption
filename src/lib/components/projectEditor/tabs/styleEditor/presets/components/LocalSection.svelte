<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { getResolutionLabel } from '../actions/presetUtils';
	import { applyPreset, deletePreset } from '../actions/localActions';
	import type { SavedVideoStylePreset } from '$lib/classes/Settings.svelte';

	let presets = $derived(() => globalState.settings?.savedVideoStylePresets ?? []);
	let localSearchQuery = $derived(globalState.presetLibrary.localSearchQuery);

	let filteredLocalPresets = $derived((): SavedVideoStylePreset[] => {
		const query = localSearchQuery.trim().toLowerCase();
		if (!query) return presets();
		return presets().filter((preset) => preset.name.toLowerCase().includes(query));
	});
</script>

<section class="space-y-3">
	<div>
		<h3 class="text-sm font-semibold text-primary">{$LL.style.localPresetsHeading()}</h3>
		<p class="text-xs text-secondary">{presets().length} {$LL.style.localPresets()}</p>
	</div>

	<div class="flex gap-1.5 overflow-x-auto pb-0.5">
		<button
			class="btn flex h-8 shrink-0 items-center gap-1 px-2 text-[11px]"
			type="button"
			onclick={() => globalState.getVideoStyle.importStylesFromFile()}
		>
			<span class="material-icons-outlined text-sm">folder_open</span>
			{$LL.style.chooseFile()}
		</button>
		<button
			class="btn flex h-8 shrink-0 items-center gap-1 px-2 text-[11px]"
			type="button"
			onclick={() => (globalState.presetLibrary.modalMode = 'export')}
		>
			<span class="material-icons-outlined text-sm">upload_file</span>
			{$LL.style.exportFile()}
		</button>
		<button
			class="btn flex h-8 shrink-0 items-center gap-1 px-2 text-[11px]"
			type="button"
			onclick={() => globalState.getVideoStyle.resetStyles()}
		>
			<span class="material-icons-outlined text-sm">restart_alt</span>
			{$LL.common.reset()}
		</button>
	</div>

	{#if presets().length > 0}
		<label class="relative block">
			<span
				class="material-icons-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
			>
				search
			</span>
			<input
				bind:value={globalState.presetLibrary.localSearchQuery}
				class="h-9 w-full rounded-md border border-color bg-primary py-1 pl-8 pr-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
				type="search"
				placeholder={$LL.style.searchSavedPresets()}
			/>
		</label>
	{/if}

	<div class="max-h-40 overflow-y-auto rounded-lg border border-color bg-primary/40 p-1">
		{#if filteredLocalPresets().length === 0}
			<div class="flex flex-col items-center justify-center gap-2 px-3 py-5 text-center">
				<span class="material-icons-outlined text-xl text-thirdly">folder_open</span>
				<p class="text-xs text-thirdly">
					{presets().length === 0 ? $LL.style.noLocalPresets() : $LL.style.noLocalPresetsFound()}
				</p>
				{#if presets().length === 0}
					<button
						class="btn-accent mt-1 flex h-9 items-center gap-1.5 px-3 text-xs font-medium"
						type="button"
						onclick={() => (globalState.presetLibrary.modalMode = 'save')}
					>
						<span class="material-icons-outlined text-base">add</span>
						{$LL.style.saveCurrentStyles()}
					</button>
				{/if}
			</div>
		{:else}
			<div class="space-y-1">
				{#each filteredLocalPresets() as preset (preset.id)}
					<div
						class="group flex min-h-10 w-full items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-black/30"
					>
						<button
							class="flex min-w-0 flex-1 items-center gap-2 rounded py-1 pr-1 text-left focus:outline-none"
							type="button"
							onclick={() => applyPreset(preset)}
							title={preset.name}
						>
							<span
								class="material-icons-outlined shrink-0 text-base! text-secondary group-hover:text-primary"
							>
								description
							</span>
							<span class="min-w-0 flex-1 truncate text-xs font-medium text-primary">
								{preset.name}
							</span>
							<span
								class="shrink-0 rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] leading-4 text-secondary"
							>
								{getResolutionLabel(preset.resolution)}
							</span>
						</button>
						<button
							class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-thirdly opacity-70 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
							type="button"
							title={$LL.style.deletePresetTitle()}
							onclick={() => deletePreset(preset)}
						>
							<span class="material-icons-outlined text-sm">delete</span>
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>
