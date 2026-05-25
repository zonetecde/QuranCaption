<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { loadCommunity, loadPopularTags } from '../actions/communityActions';
	import { getDefaultPresetName } from '../actions/presetUtils';
	import { savePreset, exportJson } from '../actions/localActions';
	import PresetHeader from './PresetHeader.svelte';
	import LocalSection from './LocalSection.svelte';
	import CommunitySection from './CommunitySection.svelte';
	import PublishForm from './PublishForm.svelte';
	import StylePresetSaveExportModal from '../../StylePresetSaveExportModal.svelte';

	let { onBack }: { onBack: () => void } = $props();

	let publishMode = $derived(globalState.presetLibrary.publishMode);
	let publishPreviewUrl = $derived(globalState.presetLibrary.publishPreviewUrl);
	let modalMode = $derived(globalState.presetLibrary.modalMode);

	// Lorsque les paramètres de recherche communauté changent, recharge avec debounce
	let communityQueryKey = $derived(() => {
		const s = globalState.presetLibrary;
		return `${s.communitySearchQuery}|${s.selectedTag}|${s.selectedOrientation}|${s.selectedSort}`;
	});

	onMount(() => {
		void loadPopularTags();
		void loadCommunity();
	});

	onDestroy(() => {
		if (publishPreviewUrl) URL.revokeObjectURL(publishPreviewUrl);
	});

	$effect(() => {
		communityQueryKey();
		const timeout = setTimeout(() => {
			void loadCommunity();
		}, 250);
		return () => clearTimeout(timeout);
	});

	function closeModal() {
		globalState.presetLibrary.modalMode = null;
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<PresetHeader {onBack} />

	{#if publishMode}
		<PublishForm />
	{:else}
		<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
			<LocalSection />
			<CommunitySection />
		</div>
	{/if}
</div>

{#if modalMode}
	<div
		class="style-preset-modal modal-wrapper"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) closeModal();
		}}
	>
		<StylePresetSaveExportModal
			mode={modalMode}
			defaultName={getDefaultPresetName()}
			close={closeModal}
			onSavePreset={savePreset}
			onExportJson={exportJson}
		/>
	</div>
{/if}
