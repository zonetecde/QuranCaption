<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import ExportService from '$lib/services/ExportService';
	import Settings from '$lib/classes/Settings.svelte';

	let {
		description = 'Choose where your exported files will be saved.'
	}: { description?: string } = $props();

	let currentExportFolder = $state('');

	onMount(async () => {
		currentExportFolder = await ExportService.getExportFolder();
	});

	async function changeExportFolder() {
		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: currentExportFolder
		});

		if (selected) {
			globalState.settings!.persistentUiState.videoExportFolder = selected as string;
			currentExportFolder = selected as string;
			await Settings.save();
		}
	}

	async function resetExportFolder() {
		globalState.settings!.persistentUiState.videoExportFolder = '';
		currentExportFolder = await ExportService.getExportFolder();
		await Settings.save();
	}
</script>

{#if description}
	<p class="text-thirdly text-sm mb-4">{description}</p>
{/if}

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-2">
		<input
			type="text"
			readonly
			class="flex-1 bg-secondary border border-color rounded p-2 text-sm text-secondary truncate"
			title={currentExportFolder}
			bind:value={currentExportFolder}
		/>
		<button class="btn-accent px-3 py-2 text-sm cursor-pointer" onclick={changeExportFolder}>
			Browse
		</button>
	</div>
	{#if globalState.settings?.persistentUiState.videoExportFolder}
		<button
			class="text-accent-primary text-xs self-start cursor-pointer ml-auto opacity-50 hover:underline underline-offset-2"
			onclick={resetExportFolder}
		>
			Reset to default location
		</button>
	{/if}
</div>
