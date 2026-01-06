<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
	import { openPath, openUrl } from '@tauri-apps/plugin-opener';
	import { exists } from '@tauri-apps/plugin-fs';
	import { invoke } from '@tauri-apps/api/core';
	import ModalManager from './modals/ModalManager';
	import { slide } from 'svelte/transition';
	import { onMount, onDestroy } from 'svelte';

	// Variable réactive pour forcer les mises à jour
	let currentTime = $state(Date.now());
	let intervalId: number | undefined;

	// Fonction pour formater la durée en format lisible
	function formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}

	// Fonction pour formater le temps actuel traité
	function formatCurrentTime(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	// Fonction pour obtenir la couleur selon l'état
	function getStateColor(state: ExportState): string {
		switch (state) {
			case ExportState.WaitingForRecord:
				return 'text-yellow-400';
			case ExportState.Recording:
				return 'text-blue-400';
			case ExportState.AddingAudio:
				return 'text-purple-400';
			case ExportState.Exported:
				return 'text-green-400';
			case ExportState.Error:
				return 'text-red-400';
			case ExportState.Canceled:
				return 'text-gray-400';
			case ExportState.CreatingVideo:
				return 'text-purple-400';
			case ExportState.CapturingFrames:
				return 'text-blue-400';
			case ExportState.Initializing:
				return 'text-yellow-400';
			default:
				return 'text-gray-400';
		}
	}

	// Fonction pour obtenir l'icône selon l'état
	function getStateIcon(state: ExportState): string {
		switch (state) {
			case ExportState.WaitingForRecord:
				return 'schedule';
			case ExportState.Recording:
				return 'videocam';
			case ExportState.AddingAudio:
				return 'audio_file';
			case ExportState.Exported:
				return 'check_circle';
			case ExportState.Error:
				return 'error';
			case ExportState.Canceled:
				return 'cancel';
			case ExportState.CreatingVideo:
				return 'movie_creation';
			case ExportState.CapturingFrames:
				return 'photo_camera';
			case ExportState.Initializing:
				return 'hourglass_top';
			default:
				return 'help';
		}
	}

	// Fonction pour ouvrir le fichier exporté
	async function openExportedFile(filePath: string) {
		if (await exists(filePath)) {
			await invoke('open_explorer_with_file_selected', { filePath });
		} else {
			ModalManager.errorModal(
				'File not found',
				'The exported file could not be found on your system. It has either been deleted or moved.'
			);
		}
	}

	// Lifecycle hooks pour gérer l'intervalle
	onMount(() => {
		// Mettre à jour le temps actuel toutes les secondes
		intervalId = setInterval(() => {
			currentTime = Date.now();
		}, 1000);
	});

	onDestroy(() => {
		// Nettoyer l'intervalle quand le composant est détruit
		if (intervalId) {
			clearInterval(intervalId);
		}
	});
</script>

{#if globalState.uiState.showExportMonitor}
	<div
		class="absolute top-12 right-4 w-[650px] max-h-[500px] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-50 overflow-hidden"
		role="dialog"
		aria-labelledby="export-monitor-title"
		transition:slide
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-4 border-b border-gray-700">
			<div class="flex items-center gap-2">
				<span class="material-icons text-blue-400">download</span>
				<h3 id="export-monitor-title" class="text-lg font-semibold text-white">Exports Monitor</h3>
				<div class="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
					{globalState.exportations.length}
				</div>
			</div>
			<button
				class="text-gray-400 hover:text-white transition-colors cursor-pointer"
				onclick={() => (globalState.uiState.showExportMonitor = false)}
				aria-label="Close export monitor"
			>
				<span class="material-icons">close</span>
			</button>
		</div>

		{#if globalState.exportations.length > 0}
			<!-- Exports List -->
			<div
				class="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600"
			>
				{#each globalState.exportations as exportation (exportation.exportId)}
					<div class="p-4 border-b border-gray-800 last:border-b-0 relative">
						<!-- delete cross -->
						<button
							class="absolute top-2 right-2 text-gray-400 hover:text-white transition-colors cursor-pointer"
							onclick={async (e) => {
								e.stopPropagation();

								if (exportation.isOnGoing()) {
									const resp = await ModalManager.confirmModal(
										'Are you sure you want to cancel this export? This action cannot be undone.'
									);

									if (resp) {
										await exportation.cancelExport();
									}
								} else {
									// Remove from the list if not ongoing
									globalState.exportations = globalState.exportations.filter(
										(e) => e.exportId !== exportation.exportId
									);
								}
							}}
							title={exportation.isOnGoing() ? 'Cancel Export' : 'Remove from list'}
						>
							<span class="material-icons">
								{#if exportation.isOnGoing()}
									cancel
								{:else}
									delete
								{/if}
							</span>
						</button>

						<!-- Export Header -->
						<div class="flex items-start justify-between mb-3">
							<div class="flex-1 min-w-0">
								<h4 class="text-white font-medium truncate mb-1" title={exportation.finalFileName}>
									{exportation.finalFileName}
								</h4>
								<div class="flex items-center gap-2 text-sm">
									<span class="material-icons text-xs {getStateColor(exportation.currentState)}">
										{getStateIcon(exportation.currentState)}
									</span>
									<span class={getStateColor(exportation.currentState)}>
										{exportation.currentState}
									</span>
								</div>
							</div>
						</div>

						<!-- Progress Bar (only if in progress) -->
						{#if exportation.isOnGoing()}
							<div class="mb-3">
								<div class="flex items-center justify-between text-xs text-gray-400 mb-1">
									<span>Progress</span>
									<span>{Math.round(exportation.percentageProgress)}%</span>
								</div>
								<div class="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
									<div
										class="h-2 transition-all duration-300 ease-out bg-gradient-to-r from-blue-400 to-purple-300"
										style="width: {Math.max(0, Math.min(100, exportation.percentageProgress))}%"
									></div>
								</div>
								<div class="flex justify-between text-xs text-gray-400 mt-1">
									{#if exportation.currentTreatedTime > 0}
										<div>
											Processed time: {formatCurrentTime(exportation.currentTreatedTime)} / {formatDuration(
												exportation.videoLength
											)}
										</div>
									{/if}
									<div class="ml-auto">
										Export Time: {formatCurrentTime(
											currentTime - new Date(exportation.date).getTime()
										)}
									</div>
								</div>
							</div>
						{/if}

						<!-- Export Details -->
						<div class="grid grid-cols-4 grid-rows-1 gap-3 text-xs">
							<div class="bg-gray-800/50 rounded-lg p-2">
								<div class="text-gray-400 mb-1 text-center">Dimensions</div>
								<div class="text-white font-mono text-center">
									{exportation.videoDimensions.width}×{exportation.videoDimensions.height}
								</div>
							</div>

							<div class="bg-gray-800/50 rounded-lg p-2">
								<div class="text-gray-400 mb-1 text-center">Duration</div>
								<div class="text-white font-mono text-center">
									{formatDuration(exportation.videoLength)}
								</div>
							</div>

							<div class="bg-gray-800/50 rounded-lg p-2 col-span-2">
								<div class="text-gray-400 mb-1 text-center">Verses</div>
								<div class="text-white truncate text-center" title={exportation.verseRange}>
									{exportation.verseRange}
								</div>
							</div>
						</div>

						<!-- Error Message (if error) -->
						{#if exportation.currentState === ExportState.Error && exportation.errorLog}
							<div class="mt-3 p-2 bg-red-900/30 border border-red-700 rounded-lg">
								<div class="flex items-center gap-2 text-red-400 text-sm mb-1">
									<span class="material-icons text-sm">error</span>
									<span class="font-medium">Export Error</span>
								</div>
								<div
									class="text-red-300 text-xs font-mono bg-red-950/50 p-2 rounded overflow-auto max-h-[100px]"
								>
									{#if exportation.errorLog.includes('allocate memory')}
										<p>
											It appears your computer cannot allocate enough memory for the export process.
											Try the following:
										</p>
										<ol class="ml-4 list-decimal text-sm">
											<li>Reduce the chunk duration (set it below the FPS value).</li>
											<li>Lower the video resolution.</li>
											<li>Remove any background video.</li>
											<li>Close other applications to free up memory for the export.</li>
										</ol>
									{/if}

									{@html exportation.errorLog.replaceAll('\\n', '<br>')}
								</div>
							</div>
						{/if}

						<!-- Export Success Info (if completed) -->
						{#if exportation.currentState === ExportState.Exported}
							<div class="mt-3 p-2 bg-green-900/10 border border-green-600/30 rounded-lg">
								<div class="flex items-center justify-between text-green-200 text-sm mb-1">
									<div class="flex items-center gap-2">
										<span class="material-icons text-sm">check_circle</span>
										<span class="font-medium">Export completed successfully</span>
									</div>
									{#if exportation.completedDate}
										<div class="text-xs opacity-70">
											Duration: {formatDuration(new Date(exportation.completedDate).getTime() - new Date(exportation.date).getTime())}
										</div>
									{/if}
								</div>
								<div
									class="text-green-100/80 text-xs flex gap-x-2"
									title={exportation.finalFilePath}
								>
									📁<button
										class="select-text! truncate cursor-pointer"
										onclick={() => openExportedFile(exportation.finalFilePath)}
									>
										{exportation.finalFilePath}</button
									>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="p-3 text-center flex items-center flex-col py-10 gap-y-2">
				<span class="material-icons text-[30px]!">info</span>
				<p>You have no ongoing exports.</p>
			</div>
		{/if}

		<!-- Footer Actions -->
		<div class="p-3 border-t border-gray-700 bg-gray-800/50">
			<div class="flex items-center justify-between">
				<div class="text-xs text-gray-400">
					{globalState.exportations.filter((e) => e.isOnGoing()).length} in progress
				</div>
				{#if globalState.exportations.some((e) => !e.isOnGoing())}
					<button
						class="text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
						onclick={() => {
							// Remove completed/error/canceled exports
							globalState.exportations = globalState.exportations.filter((e) => e.isOnGoing());
						}}
					>
						Clear completed
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.scrollbar-thin {
		scrollbar-width: thin;
	}

	.scrollbar-track-gray-800 {
		scrollbar-color: #374151 #1f2937;
	}

	.scrollbar-thumb-gray-600 {
		scrollbar-color: #4b5563 #374151;
	}
</style>
