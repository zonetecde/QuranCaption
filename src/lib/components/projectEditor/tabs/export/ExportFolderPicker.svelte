<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import ExportService from '$lib/services/ExportService';
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	let { description = LL_.export.exportFolderDescription() }: { description?: string } = $props();

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
	<p class="mb-3 text-xs leading-snug text-thirdly">{description}</p>
{/if}

<div class="flex w-full min-w-0 flex-col gap-2">
	<div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
		<input
			type="text"
			class="h-10 min-w-0 w-full rounded border border-color bg-secondary p-2 text-xs text-secondary"
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
		<button class="btn-accent h-10 cursor-pointer px-3 text-xs" onclick={changeExportFolder}>
			{$LL.export.browse()}
		</button>
	</div>
	{#if globalState.settings?.persistentUiState.videoExportFolder}
		<button
			class="ml-auto min-h-8 cursor-pointer text-xs text-accent-primary opacity-70 underline-offset-2 hover:underline"
			onclick={resetExportFolder}
		>
			{$LL.export.resetToDefault()}
		</button>
	{/if}
</div>
