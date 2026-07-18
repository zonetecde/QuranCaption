<script lang="ts">
	import {
		isBatchProjectSegmentationVerified,
		type Batch,
		type BatchMediaMode,
		type BatchMediaStatus,
		type BatchProjectItem,
		type BatchSegmentationStatus
	} from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		BatchMediaService,
		isBatchMediaModeCompatible,
		type BatchMediaActivity,
		type BatchMediaQueueProgress
	} from '$lib/services/BatchMediaService';
	import { BatchService } from '$lib/services/BatchService';
	import {
		BatchSegmentationService,
		inspectBatchSegmentationEligibility,
		reconcileBatchSegmentations,
		type BatchSegmentationActivity,
		type BatchSegmentationEligibility,
		type BatchSegmentationLiveStatus,
		type BatchSegmentationQueueProgress
	} from '$lib/services/BatchSegmentationService';
	import {
		buildBatchSegmentationRunConfiguration,
		validateBatchSegmentationRuntime,
		type BatchSegmentationRunConfiguration,
		type BatchSurahSplitterChoice
	} from '$lib/services/BatchSegmentationSettings';
	import { discordService } from '$lib/services/DiscordService';
	import { ProjectService } from '$lib/services/ProjectService';
	import { notifyLongTaskCompletion } from '$lib/services/UserAttentionService';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';

	let batch = $state<Batch | null>(null);
	let error = $state('');
	let queueError = $state('');
	let selectedIds = $state<Set<number>>(new Set());
	let showMediaModal = $state(false);
	let selectedMode = $state<BatchMediaMode>('audio_only');
	let queueActive = $state(false);
	let segmentationQueueActive = $state(false);
	let revision = $state(0);
	let activities = $state<Map<number, BatchMediaActivity>>(new Map());
	let queueProgress = $state<BatchMediaQueueProgress>({
		active: 0,
		completed: 0,
		failed: 0,
		remaining: 0,
		progress: 0
	});
	let showSegmentationModal = $state(false);
	let segmentationModalLoading = $state(false);
	let segmentationRuntimeError = $state<string | null>(null);
	let segmentationInspection = $state<BatchSegmentationEligibility[]>([]);
	let replaceExistingSubtitles = $state(false);
	let surahSplitterChoice = $state<BatchSurahSplitterChoice | null>(null);
	let segmentationConfiguration = $state<BatchSegmentationRunConfiguration | null>(null);
	let segmentationActivities = $state<Map<number, BatchSegmentationActivity>>(new Map());
	let segmentationLive = $state<Map<number, BatchSegmentationLiveStatus>>(new Map());
	let segmentationProgress = $state<BatchSegmentationQueueProgress>({
		active: 0,
		completed: 0,
		needsReview: 0,
		failed: 0,
		remaining: 0
	});

	let projects = $derived.by(() => {
		revision;
		return batch ? [...batch.projects] : [];
	});
	let selectedProjects = $derived(projects.filter((project) => selectedIds.has(project.projectId)));
	let savedSegmentationSettings = $derived(globalState.settings?.autoSegmentationSettings ?? null);
	let eligibleSelected = $derived(
		selectedProjects.filter((project) => project.media.status !== 'completed')
	);
	let completedSelected = $derived(
		selectedProjects.filter((project) => project.media.status === 'completed')
	);
	let segmentationSelected = $derived(
		selectedProjects.filter(
			(project) =>
				project.media.status === 'completed' &&
				project.segmentation.status !== 'queued' &&
				project.segmentation.status !== 'processing'
		)
	);
	let segmentationModalEligible = $derived(
		segmentationInspection.filter(
			(result) =>
				result.reason === null ||
				(replaceExistingSubtitles &&
					(result.reason === 'EXISTING_SUBTITLES' || result.reason === 'ALREADY_VALIDATED'))
		)
	);
	let segmentationModalIgnored = $derived(
		segmentationInspection.filter((result) => !segmentationModalEligible.includes(result))
	);
	let needsSurahChoice = $derived(
		segmentationModalEligible.length > 1 &&
			savedSegmentationSettings?.mode === 'local' &&
			savedSegmentationSettings.localAsrMode === 'surah_splitter' &&
			savedSegmentationSettings.surahSplitterSurah !== null
	);
	let reviewProjects = $derived(
		projects.filter((project) => project.segmentation.status === 'needs_review')
	);
	let readyForTranslations = $derived(projects.filter(isBatchProjectSegmentationVerified).length);
	let allMediaCompleted = $derived(
		projects.length > 0 && projects.every((project) => project.media.status === 'completed')
	);
	let segmentationStageActive = $derived(
		segmentationQueueActive ||
			projects.some((project) => project.segmentation.status !== 'not_started')
	);
	let incompatibleProjects = $derived(
		eligibleSelected.filter((project) => !isBatchMediaModeCompatible(project, selectedMode))
	);
	let allSelected = $derived(
		projects.length > 0 && projects.every((project) => selectedIds.has(project.projectId))
	);

	/**
	 * Résout une nouvelle traduction Batch sans dépendre des types générés au pre-commit.
	 * @param {string} key Clé du message Batch.
	 * @param {Record<string, string | number>} params Paramètres éventuels du message.
	 * @returns {string} Message localisé.
	 */
	function batchMessage(key: string, params: Record<string, string | number> = {}): string {
		const translator = Reflect.get(get(LL).batch, key) as
			| ((values?: Record<string, string | number>) => string)
			| undefined;
		return translator?.(params) ?? key;
	}

	/**
	 * Retourne à la homepage en fermant le workspace actif.
	 * @returns {void}
	 */
	function backToHome(): void {
		globalState.currentBatchId = null;
		globalState.currentPage = 'home';
	}

	/**
	 * Renouvelle l'identité d'une ligne mutée par un service pour rafraîchir le tableau indexé.
	 * @param {BatchProjectItem} project Projet dont l'état vient de changer.
	 * @returns {void}
	 */
	function refreshProjectRow(project: BatchProjectItem): void {
		if (!batch) return;
		batch.projects = batch.projects.map((item) =>
			item.projectId === project.projectId ? { ...project } : item
		);
		revision++;
	}

	/**
	 * Traduit l'état média persistant d'un projet du batch.
	 * @param {BatchMediaStatus} status État média à afficher.
	 * @returns {string} Libellé localisé.
	 */
	function getMediaLabel(status: BatchMediaStatus): string {
		const messages = get(LL).batch;
		switch (status) {
			case 'pending':
				return messages.notImported();
			case 'queued':
				return messages.queued();
			case 'processing':
				return messages.processing();
			case 'completed':
				return messages.completed();
			case 'failed':
				return messages.failed();
		}
	}

	/**
	 * Traduit l'activité temps réel d'une ligne en cours.
	 * @param {BatchProjectItem} project Projet affiché.
	 * @returns {string} Libellé de progression.
	 */
	function getActivityLabel(project: BatchProjectItem): string {
		const activity = activities.get(project.projectId);
		if (project.media.status !== 'processing' || !activity) {
			return getMediaLabel(project.media.status);
		}
		switch (activity) {
			case 'downloading':
				return batchMessage('downloading');
			case 'copying':
				return batchMessage('copyingLocal');
			case 'finalizing':
				return batchMessage('addingTimeline');
			case 'saving':
				return batchMessage('savingProject');
			default:
				return getMediaLabel(project.media.status);
		}
	}

	/**
	 * Traduit le mode média persistant d'une ligne.
	 * @param {BatchMediaMode | null} mode Mode à afficher.
	 * @returns {string} Libellé localisé ou chaîne vide.
	 */
	function getModeLabel(mode: BatchMediaMode | null): string {
		if (!mode) return '';
		return batchMessage(mode === 'audio_only' ? 'audioOnly' : 'audioVideo');
	}

	/**
	 * Traduit le statut persistant de segmentation.
	 * @param {BatchSegmentationStatus} status Statut à afficher.
	 * @returns {string} Libellé localisé.
	 */
	function getSegmentationLabel(status: BatchSegmentationStatus): string {
		const keys: Record<BatchSegmentationStatus, string> = {
			not_started: 'segmentationNotStarted',
			queued: 'segmentationQueued',
			processing: 'segmentationProcessing',
			auto_verified: 'segmentationAutoVerified',
			needs_review: 'segmentationNeedsReview',
			manually_verified: 'segmentationManuallyVerified',
			failed: 'segmentationFailed'
		};
		return batchMessage(keys[status]);
	}

	/**
	 * Traduit l'activité de segmentation ou reprend le statut backend actif.
	 * @param {BatchProjectItem} project Projet affiché.
	 * @returns {string} Détail localisé ou backend.
	 */
	function getSegmentationActivityLabel(project: BatchProjectItem): string {
		const live = segmentationLive.get(project.projectId);
		if (project.segmentation.status === 'processing' && live?.message) return live.message;
		const activity = segmentationActivities.get(project.projectId);
		if (project.segmentation.status === 'processing' && activity === 'applying') {
			return batchMessage('segmentationApplying');
		}
		if (project.segmentation.status === 'processing' && activity === 'saving') {
			return batchMessage('segmentationSaving');
		}
		return getSegmentationLabel(project.segmentation.status);
	}

	/**
	 * Traduit une raison technique d'inéligibilité au lancement.
	 * @param {BatchSegmentationEligibility['reason']} reason Code stable.
	 * @returns {string} Explication localisée.
	 */
	function getEligibilityReason(reason: BatchSegmentationEligibility['reason']): string {
		if (!reason) return '';
		return batchMessage(`segmentationReason${reason}`);
	}

	/**
	 * Traduit les erreurs techniques persistées connues.
	 * @param {string | null} errorValue Erreur brute ou code stable.
	 * @returns {string} Message affichable.
	 */
	function getSegmentationError(errorValue: string | null): string {
		if (errorValue === 'SEGMENTATION_INTERRUPTED') {
			return batchMessage('segmentationInterrupted');
		}
		if (errorValue === 'SEGMENTATION_ALREADY_RUNNING') {
			return batchMessage('segmentationAlreadyRunning');
		}
		return errorValue ?? '';
	}

	/**
	 * Ajoute ou retire un projet de la sélection UI.
	 * @param {number} projectId Identifiant du projet.
	 * @returns {void}
	 */
	function toggleProject(projectId: number): void {
		const next = new Set(selectedIds);
		if (next.has(projectId)) next.delete(projectId);
		else next.add(projectId);
		selectedIds = next;
	}

	/**
	 * Sélectionne ou désélectionne toutes les lignes consultables.
	 * @returns {void}
	 */
	function toggleAll(): void {
		selectedIds = allSelected
			? new Set()
			: new Set(
					projects
						.filter((project) => project.media.status !== 'processing')
						.map((project) => project.projectId)
				);
	}

	/**
	 * Ouvre le choix de mode pour les projets éligibles sélectionnés.
	 * @returns {void}
	 */
	function openMediaModal(): void {
		if (eligibleSelected.length === 0 || queueActive || segmentationQueueActive) return;
		selectedMode = 'audio_only';
		showMediaModal = true;
	}

	/**
	 * Valide le moteur et les projets avant d'afficher le résumé de segmentation.
	 * @returns {Promise<void>} Promesse résolue après l'inspection des projets.
	 */
	async function openSegmentationModal(): Promise<void> {
		if (segmentationSelected.length === 0 || queueActive || segmentationQueueActive) return;
		showSegmentationModal = true;
		segmentationModalLoading = true;
		segmentationRuntimeError = null;
		replaceExistingSubtitles = false;
		surahSplitterChoice = null;
		const settings = savedSegmentationSettings;
		if (!settings) {
			segmentationRuntimeError = 'SETTINGS_UNAVAILABLE';
			segmentationModalLoading = false;
			return;
		}
		segmentationConfiguration = buildBatchSegmentationRunConfiguration(settings);
		try {
			const runtimeError = await validateBatchSegmentationRuntime(settings);
			segmentationRuntimeError = runtimeError;
			segmentationInspection = await inspectBatchSegmentationEligibility(segmentationSelected);
		} catch (inspectionError) {
			segmentationRuntimeError = String(inspectionError);
			segmentationInspection = [];
		} finally {
			segmentationModalLoading = false;
		}
	}

	/**
	 * Lance la queue de segmentation avec le snapshot confirmé.
	 * @returns {Promise<void>} Promesse résolue lorsque toutes les tâches sont terminales.
	 */
	async function startSegmentation(): Promise<void> {
		if (
			!batch ||
			segmentationRuntimeError ||
			segmentationModalEligible.length === 0 ||
			(needsSurahChoice && !surahSplitterChoice)
		)
			return;
		const settings = savedSegmentationSettings;
		if (!settings) return;
		const configuration = buildBatchSegmentationRunConfiguration(
			settings,
			surahSplitterChoice ?? undefined
		);
		segmentationConfiguration = configuration;
		showSegmentationModal = false;
		segmentationQueueActive = true;
		queueError = '';
		segmentationProgress = {
			active: 0,
			completed: 0,
			needsReview: 0,
			failed: 0,
			remaining: segmentationModalEligible.length
		};
		const service = new BatchSegmentationService({
			onUpdate: (project, activity, progress, live) => {
				segmentationActivities = new Map(segmentationActivities).set(project.projectId, activity);
				segmentationLive = new Map(segmentationLive).set(project.projectId, live);
				segmentationProgress = progress;
				refreshProjectRow(project);
			}
		});
		try {
			await service.run(
				batch,
				segmentationModalEligible.map((result) => result.item),
				configuration,
				replaceExistingSubtitles
			);
			await notifyLongTaskCompletion({
				title: batchMessage('segmentationCompletedTitle'),
				body: batchMessage('segmentationCompletedBody', {
					completed: segmentationProgress.completed,
					needsReview: segmentationProgress.needsReview,
					failed: segmentationProgress.failed
				}),
				level: segmentationProgress.failed > 0 ? 'error' : 'success'
			});
			selectedIds = new Set(
				batch.projects
					.filter(
						(project) =>
							project.segmentation.status === 'failed' ||
							project.segmentation.status === 'needs_review'
					)
					.map((project) => project.projectId)
			);
		} catch (segmentationError) {
			queueError = getSegmentationError(String(segmentationError).replace(/^Error:\s*/, ''));
		} finally {
			segmentationQueueActive = false;
			revision++;
			await BatchService.loadUserBatchesDetails();
		}
	}

	/**
	 * Lance le pool média puis rafraîchit les détails légers de la homepage.
	 * @returns {Promise<void>} Promesse résolue lorsque les trois workers sont arrêtés.
	 */
	async function startMediaImport(): Promise<void> {
		if (!batch || incompatibleProjects.length > 0 || eligibleSelected.length === 0) return;
		showMediaModal = false;
		queueActive = true;
		queueError = '';
		queueProgress = {
			active: 0,
			completed: 0,
			failed: 0,
			remaining: eligibleSelected.length,
			progress: 0
		};
		const service = new BatchMediaService({
			onUpdate: (project, activity, progress) => {
				activities = new Map(activities).set(project.projectId, activity);
				queueProgress = progress;
				refreshProjectRow(project);
			}
		});
		try {
			await service.run(batch, [...eligibleSelected], selectedMode);
			const defaults = batch.projects.filter(
				(project) =>
					project.media.status === 'failed' ||
					(project.media.status === 'completed' &&
						(project.segmentation.status === 'not_started' ||
							project.segmentation.status === 'failed'))
			);
			selectedIds = new Set(defaults.map((project) => project.projectId));
		} catch (importError) {
			queueError = String(importError);
		} finally {
			queueActive = false;
			revision++;
			await BatchService.loadUserBatchesDetails();
		}
	}

	/**
	 * Charge un projet enfant sans perdre l'identifiant du batch actif.
	 * @param {number} projectId Identifiant du projet à ouvrir.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture.
	 */
	async function openProject(projectId: number): Promise<void> {
		const item = projects.find((project) => project.projectId === projectId);
		if (item?.media.status === 'processing' || item?.segmentation.status === 'processing') return;
		globalState.currentProject = await ProjectService.load(projectId);
		discordService.setEditingState();
	}

	/**
	 * Ouvre le premier projet encore signalé selon l'ordre du batch.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture éventuelle.
	 */
	async function reviewFirstFlaggedProject(): Promise<void> {
		const first = reviewProjects[0];
		if (first) await openProject(first.projectId);
	}

	onMount(async () => {
		if (globalState.currentBatchId === null) {
			error = get(LL).batch.noBatchSelected();
			return;
		}
		try {
			batch = await BatchService.load(globalState.currentBatchId, batchMessage('mediaInterrupted'));
			await reconcileBatchSegmentations(batch);
			const defaults = batch.projects.filter(
				(project) =>
					project.media.status === 'pending' ||
					project.media.status === 'failed' ||
					(project.media.status === 'completed' &&
						(project.segmentation.status === 'not_started' ||
							project.segmentation.status === 'failed'))
			);
			selectedIds = new Set(defaults.map((project) => project.projectId));
			revision++;
		} catch (loadError) {
			error = get(LL).batch.loadFailed({ error: String(loadError) });
		}
	});
</script>

<div class="min-h-full px-4 py-8 xl:px-12 xl:py-12">
	<div class="mx-auto max-w-7xl space-y-7">
		<header class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex min-w-0 flex-wrap items-center gap-4">
				<button class="btn btn-icon h-10 px-4" type="button" onclick={backToHome}>
					<span class="material-icons-outlined mr-2">arrow_back</span>
					{$LL.batch.backToHome()}
				</button>
				{#if batch}
					<div class="min-w-0">
						<div class="flex items-center gap-3">
							<h1 class="truncate text-3xl font-bold text-[var(--text-primary)]">{batch.name}</h1>
							<span
								class="rounded-full border border-[var(--accent-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)]"
							>
								{$LL.batch.batch()}
							</span>
						</div>
						<p class="mt-1 text-[var(--text-secondary)]">
							{$LL.batch.projectsCount({ count: batch.projects.length })}
						</p>
					</div>
				{/if}
			</div>
			{#if batch}
				<div class="flex items-center gap-3">
					<span class="text-sm text-[var(--text-secondary)]">
						{batchMessage('selectedProjects', { count: selectedProjects.length })}
					</span>
					{#if !allMediaCompleted}
						<button
							class="btn-accent inline-flex h-11 items-center justify-center gap-2 px-5"
							type="button"
							disabled={eligibleSelected.length === 0 || queueActive || segmentationQueueActive}
							onclick={openMediaModal}
						>
							<span class="material-icons-outlined leading-none">download</span>
							<span class="leading-none">{batchMessage('importMedia')}</span>
						</button>
					{/if}
					<button
						class="btn btn-primary inline-flex h-11 items-center justify-center gap-2 px-5"
						type="button"
						disabled={segmentationSelected.length === 0 || queueActive || segmentationQueueActive}
						onclick={openSegmentationModal}
					>
						<span class="material-icons-outlined leading-none">auto_fix_high</span>
						<span class="leading-none">{batchMessage('aiSegmentation')}</span>
					</button>
				</div>
			{/if}
		</header>

		{#if error}
			<p class="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-red-300">{error}</p>
		{:else if !batch}
			<p class="text-[var(--text-secondary)]">{$LL.batch.loadingBatch()}</p>
		{:else}
			{#if queueError}
				<p class="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-red-300">
					{queueError}
				</p>
			{/if}
			{#if queueActive}
				<section
					class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
				>
					<div class="flex flex-wrap justify-between gap-2 text-sm text-[var(--text-secondary)]">
						<span
							>{batchMessage('queueSummary', {
								active: queueProgress.active,
								completed: queueProgress.completed,
								failed: queueProgress.failed,
								remaining: queueProgress.remaining
							})}</span
						>
						<span>{batchMessage('globalProgress', { progress: queueProgress.progress })}</span>
					</div>
					<div class="mt-3 h-2 overflow-hidden rounded bg-[var(--border-color)]">
						<div
							class="h-full rounded bg-[var(--accent-primary)] transition-[width]"
							style={`width: ${queueProgress.progress}%`}
						></div>
					</div>
				</section>
			{/if}
			{#if segmentationQueueActive}
				<section
					class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
				>
					<p class="text-sm text-[var(--text-secondary)]">
						{batchMessage('segmentationQueueSummary', {
							active: segmentationProgress.active,
							completed: segmentationProgress.completed,
							needsReview: segmentationProgress.needsReview,
							failed: segmentationProgress.failed,
							remaining: segmentationProgress.remaining
						})}
					</p>
				</section>
			{/if}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-[var(--text-secondary)]">
					{batchMessage('readyForTranslations', {
						ready: readyForTranslations,
						total: projects.length
					})}
				</p>
				{#if reviewProjects.length > 0}
					<button
						class="btn-accent inline-flex h-10 items-center justify-center gap-2 px-4"
						type="button"
						disabled={segmentationQueueActive}
						onclick={reviewFirstFlaggedProject}
					>
						<span class="material-icons-outlined text-base leading-none">fact_check</span>
						<span class="leading-none">{batchMessage('reviewFlaggedProjects')}</span>
					</button>
				{/if}
			</div>

			<section
				class="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl"
			>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="bg-[var(--bg-accent)] text-[var(--text-secondary)]">
							<tr>
								<th class="px-4 py-3">
									<input
										type="checkbox"
										class="rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-primary)]"
										checked={allSelected}
										aria-label={batchMessage('selectProject')}
										onchange={toggleAll}
									/>
								</th>
								<th class="px-4 py-3">#</th>
								<th class="px-4 py-3">{$LL.batch.project()}</th>
								<th class="px-4 py-3">{$LL.batch.reciter()}</th>
								<th class="px-4 py-3">{$LL.batch.source()}</th>
								{#if segmentationStageActive}
									<th class="min-w-64 px-4 py-3">{batchMessage('aiSegmentation')}</th>
								{:else}
									<th class="min-w-56 px-4 py-3">{$LL.batch.media()}</th>
								{/if}
								<th class="px-4 py-3">{$LL.batch.actions()}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--border-color)]">
							{#each projects as project (project.projectId)}
								<tr>
									<td class="px-4 py-4">
										<input
											type="checkbox"
											class="rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-primary)]"
											checked={selectedIds.has(project.projectId)}
											disabled={project.media.status === 'processing' ||
												project.segmentation.status === 'processing'}
											aria-label={batchMessage('selectProject')}
											onchange={() => toggleProject(project.projectId)}
										/>
									</td>
									<td class="px-4 py-4 text-[var(--text-thirdly)]">{project.order}</td>
									<td class="px-4 py-4 font-medium text-[var(--text-primary)]">
										{project.projectName}
									</td>
									<td class="px-4 py-4 text-[var(--text-secondary)]">{project.reciter}</td>
									<td class="max-w-96 px-4 py-4 text-[var(--text-secondary)]">
										<div class="flex items-center gap-2" title={project.source.value}>
											<span class="material-icons-outlined text-base text-[var(--accent-primary)]">
												{project.source.kind === 'url' ? 'link' : 'insert_drive_file'}
											</span>
											<span class="truncate">{project.source.value}</span>
										</div>
									</td>
									{#if segmentationStageActive}
										<td class="px-4 py-4">
											<div class="flex justify-between gap-3 text-xs text-[var(--text-secondary)]">
												<span>{getSegmentationActivityLabel(project)}</span>
												{#if project.segmentation.status === 'processing' || project.segmentation.progress > 0}
													<span>{project.segmentation.progress}%</span>
												{/if}
											</div>
											{#if project.segmentation.status === 'processing'}
												<div class="mt-2 h-2 overflow-hidden rounded bg-[var(--border-color)]">
													<div
														class:animate-pulse={segmentationLive.get(project.projectId)
															?.indeterminate}
														class="h-full rounded bg-[var(--accent-primary)] transition-[width]"
														style={`width: ${segmentationLive.get(project.projectId)?.indeterminate ? 100 : project.segmentation.progress}%`}
													></div>
												</div>
											{/if}
											{#if project.segmentation.status === 'auto_verified' || project.segmentation.status === 'manually_verified'}
												<p class="mt-2 text-xs text-[var(--text-thirdly)]">
													{batchMessage('segmentationSegments', {
														count: project.segmentation.segmentsApplied
													})}
												</p>
											{:else if project.segmentation.status === 'needs_review'}
												<p
													class="mt-2 text-xs text-amber-300"
													title={batchMessage('segmentationReviewTooltip', {
														coverage: project.segmentation.review.coverage,
														lowConfidence: project.segmentation.review.lowConfidence,
														long: project.segmentation.review.long,
														wbw: project.segmentation.review.wbwTimestamps
													})}
												>
													{batchMessage('segmentationIssues', {
														count: project.segmentation.review.pending
													})}
													· {batchMessage('segmentationCoverageCount', {
														count: project.segmentation.review.coverage
													})}
													· {batchMessage('segmentationLowConfidenceCount', {
														count: project.segmentation.review.lowConfidence
													})}
												</p>
											{/if}
											{#if project.segmentation.error}
												<p class="mt-2 max-w-80 break-words text-xs text-red-300">
													{getSegmentationError(project.segmentation.error)}
												</p>
											{/if}
										</td>
									{:else}
										<td class="px-4 py-4">
											<div class="flex justify-between text-xs text-[var(--text-secondary)]">
												<span>{getActivityLabel(project)}</span>
												<span>{project.media.progress}%</span>
											</div>
											<div class="mt-2 h-2 overflow-hidden rounded bg-[var(--border-color)]">
												<div
													class="h-full rounded bg-[var(--accent-primary)] transition-[width]"
													style={`width: ${project.media.progress}%`}
												></div>
											</div>
											{#if project.media.mode}
												<p class="mt-2 text-xs text-[var(--text-thirdly)]">
													{batchMessage('mediaMode', { mode: getModeLabel(project.media.mode) })}
												</p>
											{/if}
											{#if project.media.error}
												<p class="mt-2 max-w-80 break-words text-xs text-red-300">
													{project.media.error}
												</p>
											{/if}
										</td>
									{/if}
									<td class="px-4 py-4">
										<button
											class="btn btn-icon h-9 px-3"
											type="button"
											disabled={project.media.status === 'processing' ||
												project.segmentation.status === 'processing'}
											onclick={() => openProject(project.projectId)}
										>
											<span class="material-icons-outlined mr-2 text-base">open_in_new</span>
											{project.segmentation.status === 'needs_review'
												? batchMessage('reviewProject')
												: $LL.batch.openProject()}
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
	</div>
</div>

{#if showMediaModal}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-media-title"
		>
			<h2 id="batch-media-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('importMediaTitle')}
			</h2>
			<p class="mt-2 text-sm text-[var(--text-secondary)]">
				{batchMessage('selectedForImport', { count: eligibleSelected.length })}
			</p>
			{#if completedSelected.length > 0}
				<p class="mt-1 text-sm text-[var(--text-thirdly)]">
					{batchMessage('completedIgnored', { count: completedSelected.length })}
				</p>
			{/if}

			<div class="mt-5 space-y-3">
				<label
					class="flex cursor-pointer gap-3 rounded-xl border border-[var(--border-color)] p-4 hover:border-[var(--accent-primary)]"
				>
					<input
						type="radio"
						name="batch-media-mode"
						value="audio_only"
						bind:group={selectedMode}
					/>
					<span>
						<span class="font-medium text-[var(--text-primary)]">{batchMessage('audioOnly')}</span>
						<span class="mt-1 block text-sm text-[var(--text-secondary)]">
							{batchMessage('audioOnlyDescription')}
						</span>
					</span>
				</label>
				<label
					class="flex cursor-pointer gap-3 rounded-xl border border-[var(--border-color)] p-4 hover:border-[var(--accent-primary)]"
				>
					<input
						type="radio"
						name="batch-media-mode"
						value="audio_video"
						bind:group={selectedMode}
					/>
					<span>
						<span class="font-medium text-[var(--text-primary)]">{batchMessage('audioVideo')}</span>
						<span class="mt-1 block text-sm text-[var(--text-secondary)]">
							{batchMessage('audioVideoDescription')}
						</span>
					</span>
				</label>
			</div>

			<p class="mt-4 rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
				{batchMessage(selectedMode === 'audio_only' ? 'audioOnlySummary' : 'audioVideoSummary')}
			</p>
			{#if incompatibleProjects.length > 0}
				<div
					class="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-300"
				>
					<p class="font-medium">{batchMessage('incompatibleAudioTitle')}</p>
					<ul class="mt-2 list-inside list-disc">
						{#each incompatibleProjects as project (project.projectId)}
							<li>{project.projectName}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showMediaModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn btn-primary h-10 px-5"
					type="button"
					disabled={incompatibleProjects.length > 0 || queueActive}
					onclick={startMediaImport}
				>
					<span class="material-icons-outlined mr-2">download</span>
					{batchMessage('startImport')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showSegmentationModal}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6">
		<div
			class="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-segmentation-title"
		>
			<h2 id="batch-segmentation-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('aiSegmentation')}
			</h2>
			{#if segmentationModalLoading}
				<p class="mt-4 text-sm text-[var(--text-secondary)]">
					{batchMessage('segmentationInspecting')}
				</p>
			{:else}
				<div class="mt-4 grid gap-3 sm:grid-cols-2">
					<div class="rounded-xl bg-[var(--bg-accent)] p-4">
						<p class="text-sm text-[var(--text-secondary)]">
							{batchMessage('segmentationSelectedCount', {
								count: segmentationInspection.length
							})}
						</p>
						<p class="mt-1 font-semibold text-[var(--text-primary)]">
							{batchMessage('segmentationEligibleCount', {
								count: segmentationModalEligible.length
							})}
						</p>
					</div>
					<div class="rounded-xl bg-[var(--bg-accent)] p-4 text-sm text-[var(--text-secondary)]">
						<p>
							{batchMessage('segmentationRuntime', {
								value: batchMessage(
									segmentationConfiguration?.snapshot.runtime === 'local'
										? 'segmentationRuntimeLocal'
										: 'segmentationRuntimeCloud'
								)
							})}
						</p>
						<p>
							{batchMessage('segmentationModel', {
								value: segmentationConfiguration?.snapshot.model ?? ''
							})}
						</p>
						<p>
							{batchMessage('segmentationDevice', {
								value: segmentationConfiguration?.snapshot.device ?? batchMessage('notApplicable')
							})}
						</p>
					</div>
				</div>

				{#if segmentationConfiguration}
					<div
						class="mt-4 grid gap-x-5 gap-y-2 rounded-xl border border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)] sm:grid-cols-2"
					>
						<p>
							{batchMessage('segmentationWbw', {
								value: batchMessage(
									segmentationConfiguration.snapshot.includeWbwTimestamps ? 'enabled' : 'disabled'
								)
							})}
						</p>
						<p>
							{batchMessage('segmentationMinSilence', {
								value: segmentationConfiguration.snapshot.minSilenceMs
							})}
						</p>
						<p>
							{batchMessage('segmentationMinSpeech', {
								value: segmentationConfiguration.snapshot.minSpeechMs
							})}
						</p>
						<p>
							{batchMessage('segmentationPadding', {
								value: segmentationConfiguration.snapshot.padMs
							})}
						</p>
						<p class="sm:col-span-2">
							{batchMessage(
								segmentationConfiguration.snapshot.fillBySilence
									? 'segmentationFillSilence'
									: 'segmentationFillExtend'
							)}
						</p>
					</div>
				{/if}

				<p class="mt-4 rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
					{batchMessage('segmentationSameSettings')}
					{batchMessage('segmentationSequential')}
				</p>

				{#if segmentationRuntimeError}
					<p
						class="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-300"
					>
						{batchMessage(`segmentationError${segmentationRuntimeError}`)}
					</p>
				{/if}

				{#if segmentationInspection.some((result) => result.hasExistingSubtitles)}
					<div class="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
						<p class="text-sm text-amber-200">
							{batchMessage('segmentationExistingCount', {
								count: segmentationInspection.filter((result) => result.hasExistingSubtitles).length
							})}
						</p>
						<label class="mt-3 flex items-start gap-3 text-sm text-[var(--text-primary)]">
							<input type="checkbox" class="mt-0.5" bind:checked={replaceExistingSubtitles} />
							<span>{batchMessage('segmentationReplaceExisting')}</span>
						</label>
					</div>
				{/if}

				{#if needsSurahChoice}
					<div class="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
						<p class="text-sm text-amber-200">{batchMessage('segmentationFixedSurahWarning')}</p>
						<div class="mt-3 space-y-2 text-sm text-[var(--text-primary)]">
							<label class="flex items-center gap-3">
								<input
									type="radio"
									name="surah-splitter-choice"
									value="auto"
									bind:group={surahSplitterChoice}
								/>
								<span>{batchMessage('segmentationSurahAuto')}</span>
							</label>
							<label class="flex items-center gap-3">
								<input
									type="radio"
									name="surah-splitter-choice"
									value="fixed"
									bind:group={surahSplitterChoice}
								/>
								<span>{batchMessage('segmentationSurahFixed')}</span>
							</label>
						</div>
					</div>
				{/if}

				{#if segmentationModalIgnored.length > 0}
					<div class="mt-4 rounded-xl border border-[var(--border-color)] p-4">
						<p class="font-medium text-[var(--text-primary)]">
							{batchMessage('segmentationIgnoredProjects')}
						</p>
						<ul class="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
							{#each segmentationModalIgnored as result (result.item.projectId)}
								<li>{result.item.projectName} — {getEligibilityReason(result.reason)}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}

			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					disabled={segmentationQueueActive}
					onclick={() => (showSegmentationModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn btn-primary h-10 px-5"
					type="button"
					disabled={segmentationModalLoading ||
						!!segmentationRuntimeError ||
						segmentationModalEligible.length === 0 ||
						(needsSurahChoice && !surahSplitterChoice)}
					onclick={startSegmentation}
				>
					<span class="material-icons-outlined mr-2">auto_fix_high</span>
					{batchMessage('startSegmentation')}
				</button>
			</div>
		</div>
	</div>
{/if}
