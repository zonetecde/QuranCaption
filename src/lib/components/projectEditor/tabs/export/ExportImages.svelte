<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import TimeInput from './TimeInput.svelte';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import { onMount } from 'svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let starting = $state(false);
	onMount(() => {
		if (!globalState.getExportState.videoEndTime) {
			ProjectHistoryManager.track('initialize image export range', () => {
				globalState.getExportState.videoEndTime = globalState.getAudioTrack.getDuration().ms;
			});
		}
	});
	let copy = $derived(
		$LL.export as unknown as {
			imageExportOption: () => string;
			imageExportDescription: () => string;
			exportImages: () => string;
		}
	);

	/**
	 * Démarre l'export d'images et signale les erreurs de lancement.
	 * @returns {Promise<void>} Promesse résolue après le lancement ou l'affichage de l'erreur.
	 */
	async function exportImages(): Promise<void> {
		starting = true;
		try {
			await Exporter.exportImages();
		} catch (error) {
			console.error('Failed to start image export:', error);
			toast.error(get(LL).common.unexpectedError());
		} finally {
			starting = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col rounded-lg border border-color bg-secondary p-6">
	<div class="min-h-0 flex-1 overflow-y-auto space-y-6">
		<h3 class="text-lg font-semibold text-primary">{copy.imageExportOption()}</h3>
		<p class="text-thirdly text-sm">{copy.imageExportDescription()}</p>
		<TimeInput
			label={$LL.export.startTime()}
			bind:value={globalState.getExportState.videoStartTime}
		/>
		<TimeInput label={$LL.export.endTime()} bind:value={globalState.getExportState.videoEndTime} />
		<ExportFolderPicker />
	</div>
	<div class="mt-4 flex flex-shrink-0 justify-center border-t border-color pt-4">
		<button
			class="btn-accent px-6 py-3 font-medium"
			onclick={exportImages}
			disabled={starting ||
				globalState.getExportState.videoEndTime <= globalState.getExportState.videoStartTime}
		>
			{copy.exportImages()}
		</button>
	</div>
</div>
