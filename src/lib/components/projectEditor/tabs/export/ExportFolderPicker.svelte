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

	function setCustomExportFolder(value: string) {
		currentExportFolder = value;
		if (!globalState.settings) return;
		globalState.settings.persistentUiState.videoExportFolder = value.trim();
	}

	async function persistCustomExportFolder() {
		if (!globalState.settings) return;

		const normalizedPath = currentExportFolder.trim();
		globalState.settings.persistentUiState.videoExportFolder = normalizedPath;

		// Empty input means "use default export location".
		if (!normalizedPath) {
			currentExportFolder = await ExportService.getExportFolder();
		} else {
			currentExportFolder = normalizedPath;
		}

		await Settings.save();
	}

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
			class="flex-1 bg-secondary border border-color rounded p-2 text-sm text-secondary"
			title={currentExportFolder}
			bind:value={currentExportFolder}
			oninput={(event) => setCustomExportFolder((event.currentTarget as HTMLInputElement).value)}
			onblur={persistCustomExportFolder}
			onkeydown={(event) => {
				if (event.key === 'Enter') {
					(event.currentTarget as HTMLInputElement).blur();
				}
			}}
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
