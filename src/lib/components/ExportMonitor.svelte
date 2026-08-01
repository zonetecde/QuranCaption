<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Exportation, {
		ExportKind,
		ExportState,
		type ExportLogEntry
	} from '$lib/classes/Exportation.svelte';
	import ExportService from '$lib/services/ExportService';
	import { exists } from '@tauri-apps/plugin-fs';
	import { invoke } from '@tauri-apps/api/core';
	import ModalManager from './modals/ModalManager';
	import { fade } from 'svelte/transition';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';

	const exportStartedAt = new Map<number, number>();
	let currentTime = $state(Date.now());
	let intervalId: ReturnType<typeof setInterval> | undefined;
	let expandedLogsByExportId = $state<Record<number, boolean>>({});
	let ongoingCount = $derived(
		globalState.exportations.filter((exportation) => exportation.isOnGoing()).length
	);
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);

	/**
	 * Résout une nouvelle clé du moniteur sans dépendre des types i18n régénérés au commit.
	 * @param {string} key Clé de traduction du moniteur.
	 * @returns {string} Texte localisé.
	 */
	function monitorMessage(key: string): string {
		const translator = Reflect.get(get(LL).exporterMonitor, key) as (() => string) | undefined;
		return translator?.() ?? key;
	}

	/**
	 * Ferme la feuille du moniteur d'exports.
	 * @returns {void}
	 */
	function closeMonitor(): void {
		globalState.uiState.showExportMonitor = false;
	}

	/**
	 * Formate une durée en horodatage lisible.
	 * @param {number} ms Durée en millisecondes.
	 * @returns {string} Durée HH:MM:SS ou MM:SS.
	 */
	function formatDuration(ms: number): string {
		const totalSeconds = Math.max(0, Math.floor(ms / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		return hours > 0
			? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
			: `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	/**
	 * Retourne le temps total mémorisé ou calculé depuis le lancement du monitor.
	 * @param {Exportation} exportation Export affiché.
	 * @returns {number} Temps écoulé en millisecondes.
	 */
	function getElapsedMs(exportation: Exportation): number {
		if (typeof exportation.totalExportTimeMs === 'number') return exportation.totalExportTimeMs;
		const parsedDate = new Date(exportation.date).getTime();
		const start =
			exportStartedAt.get(exportation.exportId) ??
			(Number.isFinite(parsedDate) ? parsedDate : currentTime);
		exportStartedAt.set(exportation.exportId, start);
		return Math.max(0, currentTime - start);
	}

	/**
	 * Estime le temps restant à partir de la progression globale.
	 * @param {Exportation} exportation Export affiché.
	 * @returns {number | null} Temps restant ou null si le ratio est insuffisant.
	 */
	function getRemainingMs(exportation: Exportation): number | null {
		const progress = clampProgress(exportation.percentageProgress);
		const elapsed = getElapsedMs(exportation);
		if (!exportation.isOnGoing() || progress <= 0 || progress >= 100 || elapsed < 3000) return null;
		return Math.max(0, (elapsed * 100) / progress - elapsed);
	}

	/**
	 * Contraint une progression à l'intervalle affichable.
	 * @param {number} progress Progression brute.
	 * @returns {number} Progression comprise entre 0 et 100.
	 */
	function clampProgress(progress: number): number {
		return Math.max(0, Math.min(100, progress || 0));
	}

	/**
	 * Retourne le libellé localisé d'un état d'export.
	 * @param {ExportState} state État métier.
	 * @returns {string} Libellé localisé.
	 */
	function getStateLabel(state: ExportState): string {
		const keys: Record<ExportState, string> = {
			[ExportState.WaitingForRecord]: 'statePending',
			[ExportState.Recording]: 'stateRecording',
			[ExportState.AddingAudio]: 'stateAddingAudio',
			[ExportState.ProcessingBackground]: 'stateProcessingBackground',
			[ExportState.AddingSubtitles]: 'stateRendering',
			[ExportState.CreatingVideo]: 'stateRendering',
			[ExportState.MergingFiles]: 'stateMerging',
			[ExportState.CapturingFrames]: 'stateCapturing',
			[ExportState.Initializing]: 'stateInitializing',
			[ExportState.Exported]: 'stateExported',
			[ExportState.Error]: 'stateError',
			[ExportState.Canceled]: 'stateCanceled'
		};
		return monitorMessage(keys[state]);
	}

	/**
	 * Retourne l'icône Material associée à un état.
	 * @param {ExportState} state État métier.
	 * @returns {string} Nom de l'icône.
	 */
	function getStateIcon(state: ExportState): string {
		switch (state) {
			case ExportState.Exported:
				return 'check_circle';
			case ExportState.Error:
				return 'error';
			case ExportState.Canceled:
				return 'cancel';
			case ExportState.WaitingForRecord:
				return 'schedule';
			case ExportState.CapturingFrames:
				return 'photo_camera';
			case ExportState.ProcessingBackground:
				return 'movie_filter';
			case ExportState.MergingFiles:
				return 'merge_type';
			default:
				return 'movie_creation';
		}
	}

	/**
	 * Retourne la couleur de statut adaptée au thème.
	 * @param {ExportState} state État métier.
	 * @returns {string} Classes Tailwind.
	 */
	function getStateColor(state: ExportState): string {
		if (state === ExportState.Exported) return 'text-green-400';
		if (state === ExportState.Error) return 'text-red-400';
		if (state === ExportState.Canceled) return 'text-thirdly';
		if (state === ExportState.ProcessingBackground) return 'text-orange-400';
		if (state === ExportState.MergingFiles) return 'text-cyan-400';
		return 'text-accent-primary';
	}

	/**
	 * Formate le compteur d'un segment répété.
	 * @param {number} current Segment courant.
	 * @param {number} total Nombre total de segments.
	 * @returns {string} Suffixe (x/N) ou chaîne vide.
	 */
	function getSegmentLabel(current: number, total: number): string {
		if (total <= 1) return '';
		return ` (${Math.max(1, Math.min(total, current || 1))}/${total})`;
	}

	/**
	 * Retourne le type MIME à utiliser pour ouvrir un export Android.
	 * @param {string} fileName Nom du fichier.
	 * @returns {string} Type MIME compatible avec ACTION_VIEW.
	 */
	function getMimeType(fileName: string): string {
		const extension = fileName.split('.').pop()?.toLowerCase();
		if (extension === 'webm') return 'video/webm';
		if (extension === 'mov') return 'video/quicktime';
		if (extension === 'mp4') return 'video/mp4';
		return 'text/plain';
	}

	/**
	 * Ouvre le média publié ou le fichier texte exporté.
	 * @param {Exportation} exportation Export à ouvrir.
	 * @returns {Promise<void>}
	 */
	async function openExportedFile(exportation: Exportation): Promise<void> {
		try {
			if (
				exportation.finalFilePath.startsWith('content://') ||
				(await exists(exportation.finalFilePath))
			) {
				const opened = await invoke<boolean>('open_android_export', {
					uri: exportation.finalFilePath,
					mimeType: getMimeType(exportation.finalFileName)
				});
				if (opened) return;
			}
		} catch (error) {
			console.error('Unable to open exported file:', error);
		}
		ModalManager.errorModal(
			get(LL).exporterMonitor.fileNotFound(),
			get(LL).exporterMonitor.exportedFileNotFound()
		);
	}

	/**
	 * Ouvre la feuille de partage Android pour un fichier exporté.
	 * @param {Exportation} exportation Export à partager.
	 * @returns {Promise<void>}
	 */
	async function shareExportedFile(exportation: Exportation): Promise<void> {
		try {
			if (
				exportation.finalFilePath.startsWith('content://') ||
				(await exists(exportation.finalFilePath))
			) {
				const shared = await invoke<boolean>('share_android_export', {
					uri: exportation.finalFilePath,
					mimeType: getMimeType(exportation.finalFileName)
				});
				if (shared) return;
			}
		} catch (error) {
			console.error('Unable to share exported file:', error);
		}
		ModalManager.errorModal(
			get(LL).exporterMonitor.fileNotFound(),
			get(LL).exporterMonitor.exportedFileNotFound()
		);
	}

	/**
	 * Annule un export actif ou retire une entrée terminée, puis persiste la liste.
	 * @param {Exportation} exportation Export ciblé.
	 * @returns {Promise<void>}
	 */
	async function removeOrCancelExport(exportation: Exportation): Promise<void> {
		if (exportation.isOnGoing()) {
			const confirmed = await ModalManager.confirmModal(
				get(LL).exporterMonitor.cancelExportConfirm()
			);
			if (!confirmed) return;
			await exportation.cancelExport();
		} else {
			globalState.exportations = globalState.exportations.filter(
				(item) => item.exportId !== exportation.exportId
			);
		}
		await ExportService.saveExports();
	}

	/**
	 * Retire toutes les entrées qui ne sont plus actives.
	 * @returns {Promise<void>}
	 */
	async function clearCompletedExports(): Promise<void> {
		globalState.exportations = globalState.exportations.filter((exportation) =>
			exportation.isOnGoing()
		);
		await ExportService.saveExports();
	}

	/**
	 * Ouvre ou ferme les logs techniques d'un export.
	 * @param {number} exportId Identifiant de l'export.
	 * @returns {void}
	 */
	function toggleExportLogs(exportId: number): void {
		expandedLogsByExportId = {
			...expandedLogsByExportId,
			[exportId]: !expandedLogsByExportId[exportId]
		};
	}

	/**
	 * Formate l'heure d'une ligne de log.
	 * @param {string} timestamp Date ISO.
	 * @returns {string} Heure locale.
	 */
	function formatExportLogTime(timestamp: string): string {
		const date = new Date(timestamp);
		return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
	}

	/**
	 * Copie les logs techniques dans le presse-papiers.
	 * @param {ExportLogEntry[]} logs Logs à copier.
	 * @returns {Promise<void>}
	 */
	async function copyExportLogs(logs: ExportLogEntry[]): Promise<void> {
		try {
			await navigator.clipboard.writeText(
				logs
					.map((log) => `[${log.timestamp}] [${log.level}] [${log.source}] ${log.message}`)
					.join('\n')
			);
			toast.success(get(LL).common.logsCopiedToClipboard());
		} catch {
			toast.error(get(LL).common.error());
		}
	}

	/**
	 * Copie le diagnostic d'une erreur d'export.
	 * @param {string} errorLog Erreur brute.
	 * @returns {Promise<void>}
	 */
	async function copyErrorLog(errorLog: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(errorLog.replaceAll('\\n', '\n'));
			toast.success(get(LL).exporterMonitor.errorCopiedToClipboard());
		} catch {
			toast.error(get(LL).exporterMonitor.failedToCopyError());
		}
	}

	onMount(() => {
		intervalId = setInterval(() => {
			currentTime = Date.now();
		}, 1000);
	});

	onDestroy(() => {
		if (intervalId) clearInterval(intervalId);
	});
</script>

{#if globalState.uiState.showExportMonitor}
	<div class="modal-wrapper export-monitor-backdrop" transition:fade={{ duration: 120 }}>
		<dialog
			open
			use:mobileModalSheet={closeMonitor}
			class="export-monitor-sheet export-monitor-ui-scale border border-color bg-primary"
			style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
			aria-modal="true"
			aria-labelledby="export-monitor-title"
		>
			<header class="export-monitor-header">
				<div class="flex min-w-0 items-center gap-3">
					<div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent">
						<span class="material-icons text-accent-primary">download</span>
					</div>
					<div class="min-w-0">
						<h2 id="export-monitor-title" class="truncate text-base font-semibold text-primary">
							{$LL.exporterMonitor.exportsMonitor()}
						</h2>
						<p class="text-xs text-thirdly">
							{get(LL).export.inProgressCount({ count: ongoingCount })}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="touch-button"
					onclick={closeMonitor}
					aria-label={$LL.exporterMonitor.closeExportMonitor()}
				>
					<span class="material-icons">close</span>
				</button>
			</header>

			<div class="export-monitor-list">
				{#if globalState.exportations.length === 0}
					<div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
						<span class="material-icons text-4xl text-thirdly">inbox</span>
						<p class="text-sm text-secondary">{get(LL).export.noOngoingExports()}</p>
					</div>
				{:else}
					{#each globalState.exportations as exportation (exportation.exportId)}
						<article class="export-card">
							<div class="flex items-start gap-3">
								<div class="min-w-0 flex-1">
									<h3 class="truncate text-sm font-semibold text-primary">
										{exportation.finalFileName}
									</h3>
									{#if exportation.exportLabel}
										<p class="truncate text-xs text-thirdly">{exportation.exportLabel}</p>
									{/if}
									<div
										class={`mt-1 flex items-center gap-1.5 text-xs ${getStateColor(exportation.currentState)}`}
									>
										<span class="material-icons text-[16px]!"
											>{getStateIcon(exportation.currentState)}</span
										>
										<span>{getStateLabel(exportation.currentState)}</span>
									</div>
								</div>
								<button
									type="button"
									class="touch-button shrink-0"
									onclick={() => removeOrCancelExport(exportation)}
									aria-label={exportation.isOnGoing()
										? $LL.exporterMonitor.cancelExport()
										: $LL.common.remove()}
								>
									<span class="material-icons text-[20px]!">
										{exportation.isOnGoing() ? 'cancel' : 'delete'}
									</span>
								</button>
							</div>

							{#if exportation.isOnGoing()}
								<div class="mt-4">
									<div class="mb-1.5 flex items-center justify-between text-xs text-secondary">
										<span>{get(LL).export.progressLabel()}</span>
										<strong>{Math.round(clampProgress(exportation.percentageProgress))}%</strong>
									</div>
									<div class="progress-track">
										<div
											class="progress-value"
											style={`width: ${clampProgress(exportation.percentageProgress)}%`}
										></div>
									</div>

									{#if exportation.exportKind === ExportKind.Video}
										{#if exportation.currentState === ExportState.CapturingFrames}
											<div class="export-guidance export-guidance-capture">
												<span class="material-icons export-guidance-icon">phone_android</span>
												<div class="min-w-0">
													<p>{monitorMessage('exportKeepOpenCapturing')}</p>
													{#if exportation.hasWordByWordStyles}
														<div class="export-wbw-hint">
															<span class="material-icons">speed</span>
															<span>{monitorMessage('captureWbwSlowHint')}</span>
														</div>
													{/if}
												</div>
											</div>
										{:else if exportation.currentState !== ExportState.WaitingForRecord && exportation.currentState !== ExportState.Recording}
											<div class="export-guidance export-guidance-background">
												<span class="material-icons export-guidance-icon">home</span>
												<p>{monitorMessage('exportCanRunInBackground')}</p>
											</div>
										{/if}
									{/if}

									{#if exportation.hasSecondarySegmentProgress}
										<div class="mt-3 space-y-2">
											<div>
												<div class="mb-1 flex justify-between gap-3 text-[11px] text-thirdly">
													<span>
														{get(LL).export.processingBgVideo()}{getSegmentLabel(
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
												<div class="progress-track h-1.5!">
													<div
														class="h-full rounded-full bg-orange-400"
														style={`width: ${clampProgress(exportation.processingBackgroundProgress)}%`}
													></div>
												</div>
											</div>
											<div>
												<div class="mb-1 flex justify-between gap-3 text-[11px] text-thirdly">
													<span>
														{get(LL).export.mergingFiles()}{getSegmentLabel(
															exportation.mergingFilesCurrentSegment,
															exportation.mergingFilesTotalSegments
														)}
													</span>
													<span>{Math.round(clampProgress(exportation.mergingFilesProgress))}%</span
													>
												</div>
												<div class="progress-track h-1.5!">
													<div
														class="h-full rounded-full bg-cyan-400"
														style={`width: ${clampProgress(exportation.mergingFilesProgress)}%`}
													></div>
												</div>
											</div>
										</div>
									{/if}

									<div
										class="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] text-thirdly"
									>
										<span>
											{get(LL).export.processedTime()}
											{formatDuration(exportation.currentTreatedTime)} / {formatDuration(
												exportation.videoLength
											)}
										</span>
										<span>
											{get(LL).export.exportTime()}
											{formatDuration(getElapsedMs(exportation))}
											{#if getRemainingMs(exportation) !== null}
												· {formatDuration(getRemainingMs(exportation) ?? 0)}
												{get(LL).export.estimated()}
											{/if}
										</span>
										{#if exportation.currentBatchSize}
											<span>{monitorMessage('batchSize')}: {exportation.currentBatchSize}</span>
										{/if}
									</div>
								</div>
							{/if}

							<div class="mt-4 grid grid-cols-2 gap-2 text-xs">
								{#if exportation.exportKind === ExportKind.Video}
									<div class="detail-pill">
										<span>{get(LL).export.dimensionsColumn()}</span>
										<strong
											>{exportation.videoDimensions.width}×{exportation.videoDimensions
												.height}</strong
										>
									</div>
									<div class="detail-pill">
										<span>{get(LL).export.durationColumn()}</span>
										<strong>{formatDuration(exportation.videoLength)}</strong>
									</div>
								{/if}
								<div class="col-span-2 flex min-w-0 gap-2">
									<div class="detail-pill min-w-0 flex-1">
										{#if exportation.exportKind === ExportKind.Video}
											<span>{get(LL).export.versesColumn()}</span>
											<strong class="truncate">{exportation.verseRange}</strong>
										{:else}
											<span>{get(LL).export.typeColumn()}</span>
											<strong>{exportation.exportLabel || get(LL).export.textExport()}</strong>
										{/if}
									</div>

									{#if exportation.currentState === ExportState.Exported}
										<button
											type="button"
											class="btn-accent inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-medium whitespace-nowrap"
											onclick={() => openExportedFile(exportation)}
										>
											<span class="material-icons text-[18px]!">play_circle</span>
											{monitorMessage('openFile')}
										</button>

										{#if exportation.exportLabel === 'Project data' || exportation.finalFileName.startsWith('qurancaption_backup_')}
											<button
												type="button"
												class="small-action shrink-0 justify-center px-3!"
												onclick={() => shareExportedFile(exportation)}
												aria-label={monitorMessage('shareFile')}
												title={monitorMessage('shareFile')}
											>
												<span class="material-icons text-[18px]!">share</span>
											</button>
										{/if}
									{:else}
										<button
											type="button"
											class="small-action shrink-0 whitespace-nowrap"
											onclick={() => toggleExportLogs(exportation.exportId)}
										>
											<span class="material-icons text-[16px]!">terminal</span>
										</button>
									{/if}
								</div>
							</div>

							{#if exportation.currentState === ExportState.Error && exportation.errorLog}
								<div class="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
									<div class="flex items-center justify-between gap-3">
										<p class="text-xs font-semibold text-red-300">
											{get(LL).export.exportErrorTitle()}
										</p>
										<button
											type="button"
											class="small-action"
											onclick={() => copyErrorLog(exportation.errorLog)}
										>
											<span class="material-icons text-[15px]!">content_copy</span>
											{get(LL).export.copyErrorButton()}
										</button>
									</div>
									<pre
										class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-red-200">{exportation.errorLog}</pre>
								</div>
							{/if}

							{#if expandedLogsByExportId[exportation.exportId]}
								<div class="mt-3 rounded-xl border border-color bg-accent p-3">
									<div class="mb-2 flex justify-end">
										<button
											type="button"
											class="small-action"
											onclick={() => copyExportLogs(exportation.exportLogs)}
										>
											<span class="material-icons text-[15px]!">content_copy</span>
											{get(LL).common.copy()}
										</button>
									</div>
									<div class="max-h-52 space-y-2 overflow-auto font-mono text-[10px]">
										{#if exportation.exportLogs.length === 0}
											<p class="text-secondary">{get(LL).export.noExportLogs()}</p>
										{:else}
											{#each exportation.exportLogs as log, index (index)}
												<div class="break-words text-secondary">
													<span class="text-thirdly">{formatExportLogTime(log.timestamp)}</span>
													<span class="mx-1 uppercase">{log.level}</span>
													<span class="text-accent-primary">[{log.source}]</span>
													{log.message}
												</div>
											{/each}
										{/if}
									</div>
								</div>
							{/if}
						</article>
					{/each}
				{/if}
			</div>

			<footer class="export-monitor-footer">
				<span class="text-xs text-thirdly"
					>{get(LL).export.inProgressCount({ count: ongoingCount })}</span
				>
				{#if globalState.exportations.some((exportation) => !exportation.isOnGoing())}
					<button type="button" class="small-action" onclick={clearCompletedExports}>
						{get(LL).export.clearCompleted()}
					</button>
				{/if}
			</footer>
		</dialog>
	</div>
{/if}

<style>
	.export-monitor-backdrop {
		z-index: 9000;
	}

	.export-monitor-sheet {
		display: flex;
		width: 100%;
		height: calc(100dvh - 28px);
		flex-direction: column;
		overflow: hidden;
		padding: 0;
		border-radius: 1rem 1rem 0 0;
		color: inherit;
		box-shadow: 0 -18px 60px rgb(0 0 0 / 35%);
	}

	.export-monitor-ui-scale {
		display: flex;
		min-width: 0;
		max-width: 100%;
		height: var(--editor-panel-height);
		flex: 1;
		flex-direction: column;
		zoom: var(--editor-panel-scale);
	}

	.export-monitor-header,
	.export-monitor-footer {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-color: var(--border-color);
		background: var(--bg-primary);
	}

	.export-monitor-header {
		min-height: 4.75rem;
		padding: 1rem 0.9rem 0.75rem;
		border-bottom-width: 1px;
	}

	.export-monitor-footer {
		min-height: calc(3.75rem + env(safe-area-inset-bottom));
		padding: 0.65rem 1rem calc(0.65rem + env(safe-area-inset-bottom));
		border-top-width: 1px;
	}

	.export-monitor-list {
		min-height: 0;
		flex: 1 1 auto;
		overflow-y: auto;
		padding: 0.75rem;
		overscroll-behavior: contain;
	}

	.export-card {
		margin-bottom: 0.75rem;
		padding: 0.9rem;
		border: 1px solid var(--border-color);
		border-radius: 1rem;
		background: var(--bg-secondary);
	}

	.touch-button {
		display: inline-flex;
		width: 2.75rem;
		height: 2.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.8rem;
		color: var(--text-secondary);
	}

	.touch-button:active,
	.small-action:active {
		background: var(--bg-accent);
		color: var(--text-primary);
	}

	.progress-track {
		width: 100%;
		height: 0.55rem;
		overflow: hidden;
		border-radius: 9999px;
		background: var(--bg-accent);
	}

	.progress-value {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--accent-primary), #a78bfa);
		transition: width 220ms ease-out;
	}

	.export-guidance {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		margin-top: 0.8rem;
		padding: 0.7rem 0.75rem;
		border: 1px solid;
		border-radius: 0.8rem;
		font-size: 0.72rem;
		line-height: 1.45;
	}

	.export-guidance-icon {
		flex: 0 0 auto;
		font-size: 1.15rem !important;
	}

	.export-guidance-capture {
		border-color: color-mix(in srgb, #f59e0b 35%, var(--border-color));
		background: color-mix(in srgb, #f59e0b 9%, var(--bg-accent));
		color: color-mix(in srgb, #fbbf24 75%, var(--text-primary));
	}

	.export-guidance-background {
		border-color: color-mix(in srgb, var(--accent-primary) 35%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 9%, var(--bg-accent));
		color: var(--text-secondary);
	}

	.export-wbw-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin-top: 0.55rem;
		padding-top: 0.55rem;
		border-top: 1px solid color-mix(in srgb, currentcolor 20%, transparent);
		color: var(--text-secondary);
	}

	.export-wbw-hint .material-icons {
		flex: 0 0 auto;
		font-size: 1rem !important;
	}

	.detail-pill {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.65rem;
		border-radius: 0.75rem;
		background: var(--bg-accent);
		color: var(--text-thirdly);
	}

	.detail-pill strong {
		color: var(--text-primary);
		font-weight: 600;
	}

	.small-action {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.35rem;
		border: 1px solid var(--border-color);
		border-radius: 0.75rem;
		padding: 0 0.75rem;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}
</style>
