<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Exportation, { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
	import { exists } from '@tauri-apps/plugin-fs';
	import { invoke } from '@tauri-apps/api/core';
	import ModalManager from './modals/ModalManager';
	import { slide } from 'svelte/transition';
	import { onMount, onDestroy } from 'svelte';
	import toast from 'svelte-5-french-toast';

	type ExportTimingSnapshot = {
		exportStartMs: number;
		stepStartMs: number;
		lastStep: number | null;
		completedAtMs: number | null;
	};

	const exportTimingSnapshots = new Map<number, ExportTimingSnapshot>();

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

	/**
	 * Retourne un timestamp valide en millisecondes depuis une date ISO.
	 * Si la date est invalide, utilise `fallbackMs`.
	 */
	function parseDateMs(value: string, fallbackMs: number): number {
		const parsed = new Date(value).getTime();
		return Number.isFinite(parsed) ? parsed : fallbackMs;
	}

	/**
	 * Retourne l'indice d'étape principal (1..4) selon l'état courant.
	 */
	function getStepIndex(state: ExportState): number | null {
		return getStepInfo(state)?.current ?? null;
	}

	/**
	 * Crée/actualise le snapshot temporel d'un export pour stabiliser
	 * le chrono global et les transitions entre étapes.
	 */
	function getTimingSnapshot(exportation: Exportation, now: number): ExportTimingSnapshot {
		let snapshot = exportTimingSnapshots.get(exportation.exportId);
		const stepIndex = getStepIndex(exportation.currentState);

		if (!snapshot) {
			const startMs = parseDateMs(exportation.date, now);
			snapshot = {
				exportStartMs: startMs,
				stepStartMs: now,
				lastStep: stepIndex,
				completedAtMs: null
			};
			exportTimingSnapshots.set(exportation.exportId, snapshot);
		}

		if (snapshot.lastStep !== stepIndex && stepIndex !== null) {
			snapshot.stepStartMs = now;
			snapshot.lastStep = stepIndex;
		}

		if (exportation.currentState === ExportState.Exported && snapshot.completedAtMs === null) {
			snapshot.completedAtMs = now;
		}

		return snapshot;
	}

	/**
	 * Calcule le temps écoulé global d'export depuis le début.
	 * Quand l'export est terminé, le temps est figé.
	 */
	function getExportElapsedMs(exportation: Exportation, now: number): number {
		if (exportation.currentState === ExportState.Exported) {
			const storedTotal = getStoredTotalExportMs(exportation);
			if (storedTotal !== null) {
				return storedTotal;
			}
		}

		const snapshot = getTimingSnapshot(exportation, now);
		const endMs = snapshot.completedAtMs ?? now;
		return Math.max(0, endMs - snapshot.exportStartMs);
	}

	/**
	 * Retourne le total sauvegardé d'un export terminé.
	 * Les anciens exports (avant ajout de ce champ) renvoient `null`.
	 */
	function getStoredTotalExportMs(exportation: Exportation): number | null {
		const value = exportation.totalExportTimeMs;
		return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
	}

	/**
	 * Estime le temps restant d'un export à partir du ratio temps écoulé / progression.
	 * Retourne `null` si l'estimation n'est pas encore fiable (démarrage, 0%, 100%).
	 */
	function getEstimatedRemainingMs(exportation: Exportation, now: number): number | null {
		if (!exportation.isOnGoing()) return null;

		const progress = clampProgress(exportation.percentageProgress);
		if (progress <= 0 || progress >= 100) return null;

		const snapshot = getTimingSnapshot(exportation, now);
		const elapsedMs = Math.max(0, now - snapshot.stepStartMs);
		// Évite une estimation instable pendant les toutes premières secondes.
		if (elapsedMs < 3000) return null;

		const estimatedTotalMs = (elapsedMs * 100) / progress;
		const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs);
		return Number.isFinite(remainingMs) ? remainingMs : null;
	}

	function isTextExport(exportation: Exportation): boolean {
		return exportation.exportKind === ExportKind.Text;
	}

	function getStepInfo(state: ExportState): { current: number; total: number } | null {
		switch (state) {
			case ExportState.CapturingFrames:
				return { current: 1, total: 4 };
			case ExportState.Initializing:
			case ExportState.ProcessingBackground:
				return { current: 2, total: 4 };
			case ExportState.AddingSubtitles:
			case ExportState.CreatingVideo:
				return { current: 3, total: 4 };
			case ExportState.MergingFiles:
				return { current: 4, total: 4 };
			default:
				return null;
		}
	}

	function getFileExtension(fileName: string): string {
		const trimmed = (fileName || '').trim();
		const dotIndex = trimmed.lastIndexOf('.');
		if (dotIndex === -1 || dotIndex === trimmed.length - 1) {
			return 'FILE';
		}
		return trimmed.slice(dotIndex + 1).toUpperCase();
	}

	/**
	 * Contraint une progression dans l'intervalle [0, 100] pour protéger l'UI.
	 */
	function clampProgress(progress: number): number {
		return Math.max(0, Math.min(100, progress || 0));
	}

	/**
	 * Formate un suffixe de type "(x/N)" pour les étapes répétées par segment.
	 */
	function getSegmentLabel(current: number, total: number): string {
		if (total <= 1) return '';
		const safeCurrent = Math.max(1, Math.min(total, current || 1));
		return ` (${safeCurrent}/${total})`;
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
			case ExportState.ProcessingBackground:
				return 'text-orange-400';
			case ExportState.AddingSubtitles:
			case ExportState.CreatingVideo:
				return 'text-purple-400';
			case ExportState.MergingFiles:
				return 'text-cyan-400';
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
			case ExportState.ProcessingBackground:
				return 'movie_filter';
			case ExportState.AddingSubtitles:
				return 'subtitles';
			case ExportState.CreatingVideo:
				return 'movie_creation';
			case ExportState.MergingFiles:
				return 'merge_type';
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

	async function copyErrorLog(errorLog: string) {
		try {
			let normalizedError = errorLog;

			// If error was JSON-stringified, decode escaped characters first.
			try {
				const parsed = JSON.parse(errorLog);
				if (typeof parsed === 'string') {
					normalizedError = parsed;
				}
			} catch {
				// Keep raw string fallback.
			}

			normalizedError = normalizedError
				.replaceAll('\\r\\n', '\n')
				.replaceAll('\\n', '\n')
				.replaceAll('\\t', '\t');

			await navigator.clipboard.writeText(normalizedError);
			toast.success('Error copied to clipboard');
		} catch {
			toast.error('Failed to copy error');
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
		class="absolute top-12 right-4 w-[650px] max-h-[500px] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl z-[999] overflow-hidden"
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
					<div class="p-2 border-b border-gray-800 last:border-b-0 relative">
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
						<div class="flex items-start justify-between mb-2">
							<div class="flex-1 min-w-0">
								<h4 class="text-white font-medium truncate mb-1" title={exportation.finalFileName}>
									{exportation.finalFileName}
								</h4>
								{#if isTextExport(exportation) && exportation.exportLabel}
									<div class="text-xs text-gray-400 truncate">{exportation.exportLabel}</div>
								{/if}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="flex items-center gap-2 min-w-0">
										<span class="material-icons text-xs {getStateColor(exportation.currentState)}">
											{getStateIcon(exportation.currentState)}
										</span>
										<span class={getStateColor(exportation.currentState)}>
											{exportation.currentState}
										</span>
									</div>
									{#if exportation.currentState === ExportState.Exported &&
										getStoredTotalExportMs(exportation) !== null}
										<span class="text-xs text-gray-300 ml-auto whitespace-nowrap">
											Total: <span class="monospaced"
												>{formatCurrentTime(getExportElapsedMs(exportation, currentTime))}</span
											>
										</span>
									{/if}
								</div>
							</div>
						</div>

						<!-- Progress Bar (only if in progress) -->
						{#if exportation.isOnGoing()}
							<div class="mb-2">
								<div class="flex items-center justify-between text-xs text-gray-400 mb-1">
									<span>Progress</span>
									<span>{Math.round(clampProgress(exportation.percentageProgress))}%</span>
								</div>
								<div class="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
									<div
										class="h-2 transition-all duration-300 ease-out bg-gradient-to-r from-blue-400 to-purple-300"
										style="width: {clampProgress(exportation.percentageProgress)}%"
									></div>
								</div>
								{#if exportation.hasSecondarySegmentProgress}
									<div class="mt-2">
										<div class="flex items-center justify-between text-xs text-gray-400 mb-1">
											<span>
												Processing bg video{getSegmentLabel(
													exportation.processingBackgroundCurrentSegment,
													exportation.processingBackgroundTotalSegments
												)}
											</span>
											<span
												>{Math.round(
													clampProgress(exportation.processingBackgroundProgress)
												)}%</span
											>
										</div>
										<div class="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
											<div
												class="h-1.5 transition-all duration-300 ease-out bg-gradient-to-r from-orange-400 to-amber-300"
												style="width: {clampProgress(exportation.processingBackgroundProgress)}%"
											></div>
										</div>
									</div>
									<div class="mt-2">
										<div class="flex items-center justify-between text-xs text-gray-400 mb-1">
											<span>
												Merging files{getSegmentLabel(
													exportation.mergingFilesCurrentSegment,
													exportation.mergingFilesTotalSegments
												)}
											</span>
											<span>{Math.round(clampProgress(exportation.mergingFilesProgress))}%</span>
										</div>
										<div class="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
											<div
												class="h-1.5 transition-all duration-300 ease-out bg-gradient-to-r from-cyan-400 to-sky-300"
												style="width: {clampProgress(exportation.mergingFilesProgress)}%"
											></div>
										</div>
									</div>
								{:else}
									<div class="flex items-center justify-between text-xs text-gray-500 mt-1">
										<span>
											{#if getStepInfo(exportation.currentState)}
												Step {getStepInfo(exportation.currentState)?.current}/{getStepInfo(
													exportation.currentState
												)?.total}
											{:else}
												Progress
											{/if}
										</span>
									</div>
								{/if}
								<div class="flex justify-between text-xs text-gray-400 mt-1">
									{#if exportation.currentTreatedTime > 0}
										<div>
											Processed time: <span class="monospaced"
												>{formatCurrentTime(exportation.currentTreatedTime)} / {formatDuration(
													exportation.videoLength
												)}</span
											>
										</div>
									{:else}
										<div>
											Processed time: <span class="monospaced"
												>0:00 / {formatDuration(exportation.videoLength)}</span
											>
										</div>
									{/if}
									<div class="ml-auto">
										Export Time:<span class="monospaced"
											>{' '}
											{formatCurrentTime(getExportElapsedMs(exportation, currentTime))}
										</span>{#if getEstimatedRemainingMs(exportation, currentTime) !== null}
											<span class="monospaced">
												{' '}({formatCurrentTime(
													getEstimatedRemainingMs(exportation, currentTime) || 0
												)} est.)
											</span>
										{:else}
											<span class="monospaced">
												{' (0:00 est.)'}
											</span>
										{/if}
									</div>
								</div>
							</div>
						{/if}

						<!-- Export Details -->
						{#if isTextExport(exportation)}
							<div class="grid grid-cols-2 grid-rows-1 gap-2 text-xs">
								<div class="bg-gray-800/50 rounded-lg p-1">
									<div class="text-gray-400 mb-1 text-center">Type</div>
									<div class="text-white font-mono text-center">
										{exportation.exportLabel || 'Text export'}
									</div>
								</div>

								<div class="bg-gray-800/50 rounded-lg p-1">
									<div class="text-gray-400 mb-1 text-center">Format</div>
									<div class="text-white font-mono text-center">
										{getFileExtension(exportation.finalFileName)}
									</div>
								</div>
							</div>
						{:else}
							<div class="grid grid-cols-4 grid-rows-1 gap-2 text-xs">
								<div class="bg-gray-800/50 rounded-lg p-1">
									<div class="text-gray-400 mb-1 text-center">Dimensions</div>
									<div class="text-white font-mono text-center">
										{exportation.videoDimensions.width}×{exportation.videoDimensions.height}
									</div>
								</div>

								<div class="bg-gray-800/50 rounded-lg p-1">
									<div class="text-gray-400 mb-1 text-center">Duration</div>
									<div class="text-white font-mono text-center">
										{formatDuration(exportation.videoLength)}
									</div>
								</div>

								<div class="bg-gray-800/50 rounded-lg p-1 col-span-2">
									<div class="text-gray-400 mb-1 text-center">Verses</div>
									<div class="text-white truncate text-center" title={exportation.verseRange}>
										{exportation.verseRange}
									</div>
								</div>
							</div>
						{/if}

						<!-- Error Message (if error) -->
						{#if exportation.currentState === ExportState.Error && exportation.errorLog}
							<div class="mt-2 p-1 bg-red-900/30 border border-red-700 rounded-lg">
								<div class="flex items-center justify-between text-red-400 text-sm mb-1">
									<div class="flex items-center gap-2">
										<span class="material-icons text-sm">error</span>
										<span class="font-medium">Export Error</span>
									</div>
									<button
										class="text-xs px-2 py-0.5 rounded border border-red-600 hover:bg-red-800/30 transition-colors cursor-pointer flex items-center gap-1"
										onclick={() => copyErrorLog(exportation.errorLog)}
										title="Copy export error details"
									>
										<span class="material-icons text-[14px]">content_copy</span>
										Copy error
									</button>
								</div>
								<div
									class="text-red-300 text-xs font-mono bg-red-950/50 p-1 rounded overflow-auto max-h-[100px]"
								>
									{#if exportation.errorLog.includes('allocate memory')}
										<p>
											It appears your computer cannot allocate enough memory for the export process.
											Try the following:
										</p>
										<ol class="ml-4 list-decimal text-sm">
											<li>Reduce the batch size.</li>
											<li>Lower the video resolution.</li>
											<li>Remove any background video.</li>
											<li>Close other applications to free up memory for the export.</li>
										</ol>
									{/if}

									<pre class="whitespace-pre-wrap break-words">{exportation.errorLog}</pre>
								</div>
							</div>
						{/if}

						<!-- Export Success Info (if completed) -->
						{#if exportation.currentState === ExportState.Exported}
							<div class="mt-2 p-1 bg-green-900/10 border border-green-600/30 rounded-lg">
								<div class="flex items-center gap-2 text-green-200 text-sm mb-1">
									<span class="material-icons text-sm">check_circle</span>
									<span class="font-medium">Export completed successfully</span>
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
