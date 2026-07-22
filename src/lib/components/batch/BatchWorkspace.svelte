<script lang="ts">
	import {
		AssetClip,
		AssetType,
		isBatchProjectSegmentationVerified,
		SubtitleClip,
		SourceType,
		TrackType,
		type Edition,
		type Batch,
		type BatchMediaMode,
		type BatchMediaStatus,
		type BatchProjectItem,
		type BatchSegmentationStatus,
		type BatchTranslationStatus
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
	import {
		openBatchReviewProject,
		openBatchTranslationReviewProject
	} from '$lib/services/BatchReviewNavigationService';
	import { BatchCbrService, type BatchCbrQueueProgress } from '$lib/services/BatchCbrService';
	import {
		BatchTranslationService,
		reconcileBatchTranslations,
		type BatchTranslationQueueProgress
	} from '$lib/services/BatchTranslationService';
	import {
		QdcTranslationService,
		type TranslationLanguageData
	} from '$lib/services/QdcTranslationService';
	import { getProjectSubtitleClips } from '$lib/services/TranslationFetchService';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import type { SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
	import { BatchStyleService, type BatchStyleProgress } from '$lib/services/BatchStyleService';
	import {
		BatchExportService,
		inspectBatchExportEligibility,
		type BatchExportEligibility,
		type BatchExportProgress
	} from '$lib/services/BatchExportService';
	import { open } from '@tauri-apps/plugin-dialog';
	import ModalManager from '$lib/components/modals/ModalManager';
	import BatchProgressCard from './BatchProgressCard.svelte';
	import BatchProjectTable from './BatchProjectTable.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import MigrationService from '$lib/services/MigrationService';
	import { BatchWorkspaceWorkflow } from '$lib/services/BatchWorkspaceWorkflow.svelte';

	let batch = $state<Batch | null>(null);
	let error = $state('');
	let queueError = $state('');
	const workflow = new BatchWorkspaceWorkflow();
	let selectedIds = $derived(workflow.selectedProjectIds);
	let showMediaModal = $state(false);
	let selectedMode = $state<BatchMediaMode>('audio_only');
	let queueActive = $derived(workflow.isActive('media'));
	let segmentationQueueActive = $derived(workflow.isActive('segmentation'));
	let cbrQueueActive = $derived(workflow.isActive('cbr'));
	let translationQueueActive = $derived(workflow.isActive('translation'));
	let translationProgress = $state<BatchTranslationQueueProgress>({
		active: 0,
		completed: 0,
		failed: 0,
		skipped: 0,
		remaining: 0,
		progress: 0,
		total: 0
	});
	let showAddTranslationsModal = $state(false);
	let showFetchTranslationsModal = $state(false);
	let showReviewEditionModal = $state(false);
	let translationModalLoading = $state(false);
	let translationSearch = $state('');
	let selectedTranslationEditionNames = $state<Set<string>>(new Set());
	let skipExistingTranslations = $state(true);
	let activeTranslationEditionName = $state<string | null>(
		globalState.shared.batchTranslationEditionName
	);
	let translationInspection = $state<
		Array<{
			item: BatchProjectItem;
			eligible: boolean;
			reason: string | null;
			existingEditions: string[];
		}>
	>([]);
	let revision = $state(0);
	let translationRowVersions = $state<Record<number, number>>({});
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
		remaining: 0,
		progress: 0,
		total: 0
	});
	let cbrProgress = $state<BatchCbrQueueProgress>({
		activeProjectId: null,
		completed: 0,
		failed: 0,
		remaining: 0,
		progress: 0,
		total: 0
	});
	let qdcTranslations = $state<Record<string, TranslationLanguageData>>({});
	let showStyleModal = $state(false);
	let showBackgroundModal = $state(false);
	let backgroundQueueActive = $derived(workflow.isActive('background'));
	let selectedStylePresetId = $state<number | null>(null);
	let styleOverwriteConfirmed = $state(false);
	let styleQueueActive = $derived(workflow.isActive('style'));
	let styleProgress = $state<BatchStyleProgress>({
		active: 0,
		completed: 0,
		failed: 0,
		remaining: 0,
		total: 0
	});
	let showExportModal = $state(false);
	let exportModalLoading = $state(false);
	let exportInspection = $state<BatchExportEligibility[]>([]);
	let exportOutputFolder = $state('');
	let exportNonReadyProjects = $state(false);
	let exportOnlyRecitation = $state(false);
	let exportModalTab = $state<'video' | 'youtube' | 'subtitles'>('video');
	let youtubeChaptersChoice = $state<'Each Surah' | 'Each Verse'>('Each Surah');
	let exportQueueActive = $derived(workflow.isActive('export'));
	let deleteQueueActive = $derived(workflow.isActive('delete'));
	let exportProgress = $state<BatchExportProgress>({
		activeProjectName: null,
		completed: 0,
		failed: 0,
		remaining: 0,
		total: 0
	});

	let projects = $derived.by(() => {
		revision;
		return batch ? [...batch.projects] : [];
	});
	let selectedProjects = $derived(workflow.getSelectedProjects(projects));
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
	let allSegmentationsVerified = $derived(
		projects.length > 0 && projects.every(isBatchProjectSegmentationVerified)
	);
	let translationEditionNames = $derived(
		Array.from(new Set(projects.flatMap((project) => Object.keys(project.translations))))
	);
	let activeTranslationStates = $derived(
		activeTranslationEditionName
			? projects.map((project) => project.translations[activeTranslationEditionName!])
			: []
	);
	let translationEditionsNeedingReview = $derived(
		translationEditionNames.filter((editionName) =>
			projects.some((project) => project.translations[editionName]?.status === 'needs_review')
		)
	);
	let allAvailableEditions = $derived.by(() => {
		const editions = [
			...Object.values(globalState.availableTranslations).flatMap((group) => group.translations),
			...Object.values(qdcTranslations).flatMap((group) => group.translations)
		];
		return Array.from(new Map(editions.map((edition) => [edition.name, edition])).values());
	});
	let filteredAvailableEditions = $derived(
		allAvailableEditions.filter((edition) =>
			`${edition.author} ${edition.language}`
				.toLowerCase()
				.includes(translationSearch.toLowerCase())
		)
	);
	let addEligibleProjects = $derived.by(() => {
		const eligibleIds = new Set(
			translationInspection
				.filter((result) => result.eligible)
				.map((result) => result.item.projectId)
		);
		return projects.filter((project) => eligibleIds.has(project.projectId));
	});
	let fetchEligibleProjects = $derived(
		activeTranslationEditionName
			? selectedProjects.filter((project) => !!project.translations[activeTranslationEditionName!])
			: []
	);
	let fetchPendingCount = $derived(
		activeTranslationEditionName
			? fetchEligibleProjects.reduce(
					(total, project) =>
						total + project.translations[activeTranslationEditionName!].review.pending,
					0
				)
			: 0
	);
	let allMediaCompleted = $derived(
		projects.length > 0 && projects.every((project) => project.media.status === 'completed')
	);
	let activeProjectStage = $derived(workflow.getActiveProjectStage(projects));
	let incompatibleQueueActive = $derived(workflow.activeOperation !== null);
	let globalOperationActive = $derived(workflow.isGlobalOperationActive());
	let styleGlobalProgress = $derived(
		Math.round(
			((styleProgress.completed + styleProgress.failed) * 100) / Math.max(styleProgress.total, 1)
		)
	);
	let exportGlobalProgress = $derived(
		Math.round(
			((exportProgress.completed + exportProgress.failed) * 100) / Math.max(exportProgress.total, 1)
		)
	);
	let translationGlobalProgress = $derived(
		translationProgress.total > 0
			? translationProgress.progress
			: Math.round(
					activeTranslationStates.reduce((sum, state) => sum + (state?.progress ?? 0), 0) /
						Math.max(projects.length, 1)
				)
	);
	let savedStylePresets = $derived(globalState.settings?.savedVideoStylePresets ?? []);
	let selectedStylePreset = $derived(
		savedStylePresets.find((preset) => preset.id === selectedStylePresetId) ?? null
	);
	let readyExports = $derived(exportInspection.filter((result) => result.reason === null));
	let ignoredExports = $derived(exportInspection.filter((result) => result.reason !== null));
	let exportCandidates = $derived(
		exportInspection.filter(
			(result) =>
				result.reason === null ||
				(exportNonReadyProjects && result.project !== null && result.reason !== 'EXPORT_ACTIVE')
		)
	);
	let skippedExports = $derived(
		exportInspection.filter((result) => !exportCandidates.includes(result))
	);
	let chapterExportCandidates = $derived(
		exportInspection.filter((result) =>
			result.project?.content.timeline
				.getFirstTrack(TrackType.Subtitle)
				.clips.some((clip) => clip instanceof SubtitleClip)
		)
	);
	let subtitleExportCandidates = $derived(chapterExportCandidates);
	let incompatibleProjects = $derived(
		eligibleSelected.filter((project) => !isBatchMediaModeCompatible(project, selectedMode))
	);
	let allSelected = $derived(workflow.areAllProjectsSelected(projects));
	let cbrCurrentProject = $derived(
		projects.find((project) => project.projectId === cbrProgress.activeProjectId) ?? null
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
	 * Ouvre la sélection du preset pour les projets cochés.
	 * @returns {void}
	 */
	function openStyleModal(): void {
		if (!batch || selectedProjects.length === 0 || incompatibleQueueActive) return;
		selectedStylePresetId = null;
		styleOverwriteConfirmed = false;
		showStyleModal = true;
	}

	/**
	 * Ouvre le choix du type de fond pour les projets cochés.
	 * @returns {void}
	 */
	function openBackgroundModal(): void {
		if (selectedProjects.length === 0 || incompatibleQueueActive) return;
		showBackgroundModal = true;
	}

	/**
	 * Sélectionne puis remplace la piste vidéo des projets cochés par le fond choisi.
	 * @param {AssetType.Image | AssetType.Video} type Type de fond à sélectionner.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde des projets.
	 */
	async function setSelectedProjectsBackground(
		type: AssetType.Image | AssetType.Video
	): Promise<void> {
		const filePath = await open({
			multiple: false,
			filters: [
				{
					name: batchMessage(type === AssetType.Image ? 'backgroundImage' : 'backgroundVideo'),
					extensions:
						type === AssetType.Image
							? ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
							: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'webm']
				}
			]
		});
		if (typeof filePath !== 'string') return;

		showBackgroundModal = false;
		if (!workflow.begin('background')) return;
		queueError = '';
		let failed = 0;
		try {
			for (const item of selectedProjects) {
				try {
					const project =
						globalState.currentProject?.detail.id === item.projectId
							? globalState.currentProject
							: await ProjectService.load(item.projectId);
					const replaceBackground = async (): Promise<void> => {
						const asset = project.content.addAssetHeadless(filePath, undefined, SourceType.Local, {
							suppressUiEffects: true,
							skipConstantBitrateWarning: true
						});
						if (!asset || asset.type !== type)
							throw new Error(batchMessage('backgroundInvalidFile'));
						await asset.ensureDurationLoaded();
						if (!asset.exists || asset.hasDurationLoadError()) {
							throw new Error(batchMessage('backgroundInvalidFile'));
						}
						const videoTrack = project.content.timeline.getFirstTrack(TrackType.Video);
						videoTrack.clips = [
							new AssetClip(
								0,
								type === AssetType.Image
									? 0
									: project.content.timeline.getFirstTrack(TrackType.Audio).getDuration().ms,
								asset.id
							)
						];
						if (type === AssetType.Video) {
							(videoTrack.clips[0] as AssetClip).loopUntilAudioEnd = true;
						}
						await ProjectService.save(project);
					};
					if (globalState.currentProject?.detail.id === project.detail.id) {
						await ProjectHistoryManager.trackAsync('set batch background', replaceBackground);
					} else {
						await replaceBackground();
					}
				} catch {
					failed++;
				}
			}
			if (failed > 0) {
				toast.error(batchMessage('backgroundSetWithFailures', { failed }));
			} else {
				toast.success(batchMessage('backgroundSet'));
			}
		} finally {
			workflow.finish('background');
		}
	}

	/**
	 * Applique le preset confirmé aux projets cochés.
	 * @returns {Promise<void>} Promesse résolue après les projets sélectionnés.
	 */
	async function applyStyleToBatch(): Promise<void> {
		if (!batch || !selectedStylePreset || !styleOverwriteConfirmed || incompatibleQueueActive)
			return;
		showStyleModal = false;
		if (!workflow.begin('style')) return;
		styleProgress = {
			active: 0,
			completed: 0,
			failed: 0,
			remaining: selectedProjects.length,
			total: selectedProjects.length
		};
		try {
			const service = new BatchStyleService({
				onUpdate: (item, progress) => {
					styleProgress = progress;
					refreshProjectRow(item);
				}
			});
			const result = await service.run(
				batch,
				selectedProjects,
				selectedStylePreset as SavedVideoStylePreset
			);
			if (result.failed > 0) {
				toast.error(batchMessage('styleAppliedWithFailures', { failed: result.failed }));
			} else {
				toast.success(batchMessage('styleApplied'));
			}
		} catch (styleError) {
			queueError = String(styleError);
		} finally {
			workflow.finish('style');
		}
	}

	/**
	 * Inspecte les projets cochés avant d'afficher la confirmation d'export.
	 * @returns {Promise<void>} Promesse résolue lorsque les incompatibilités sont connues.
	 */
	async function openExportModal(): Promise<void> {
		if (!batch || selectedProjects.length === 0 || incompatibleQueueActive) return;
		showExportModal = true;
		exportModalLoading = true;
		exportInspection = [];
		exportOutputFolder = '';
		exportNonReadyProjects = false;
		exportOnlyRecitation = false;
		exportModalTab = 'video';
		youtubeChaptersChoice = 'Each Surah';
		try {
			exportInspection = await inspectBatchExportEligibility(selectedProjects);
		} finally {
			exportModalLoading = false;
		}
	}

	/**
	 * Sélectionne le dossier commun sans modifier le réglage d'export global.
	 * @returns {Promise<void>} Promesse résolue après la boîte de dialogue native.
	 */
	async function selectBatchExportFolder(): Promise<void> {
		const selected = await open({ directory: true, multiple: false });
		if (typeof selected === 'string') exportOutputFolder = selected;
	}

	/**
	 * Exporte séquentiellement les projets confirmés, prêts ou forcés par l'utilisateur.
	 * @returns {Promise<void>} Promesse résolue après tous les exports sélectionnés.
	 */
	async function exportReadyProjects(): Promise<void> {
		if (!batch || exportCandidates.length === 0 || !exportOutputFolder || incompatibleQueueActive)
			return;
		showExportModal = false;
		if (!workflow.begin('export')) return;
		exportProgress = {
			activeProjectName: null,
			completed: 0,
			failed: 0,
			remaining: exportCandidates.length,
			total: exportCandidates.length
		};
		try {
			const service = new BatchExportService({
				onUpdate: (item, progress) => {
					exportProgress = progress;
					refreshProjectRow(item);
				}
			});
			const result = await service.run(
				batch,
				exportInspection,
				exportOutputFolder,
				exportNonReadyProjects,
				exportOnlyRecitation
			);
			if (result.failed > 0 || skippedExports.length > 0) {
				toast.error(batchMessage('someProjectsCouldNotBeExported'));
			} else {
				toast.success(batchMessage('allEligibleProjectsExported'));
			}
		} catch (exportError) {
			queueError = String(exportError);
		} finally {
			workflow.finish('export');
		}
	}

	/**
	 * Exporte les chapitres YouTube des projets cochés dans le dossier commun.
	 * @returns {Promise<void>} Promesse résolue après l'écriture de tous les fichiers.
	 */
	async function exportReadyYouTubeChapters(): Promise<void> {
		if (chapterExportCandidates.length === 0 || !exportOutputFolder || incompatibleQueueActive)
			return;
		showExportModal = false;
		if (!workflow.begin('export')) return;
		exportProgress = {
			activeProjectName: null,
			completed: 0,
			failed: 0,
			remaining: chapterExportCandidates.length,
			total: chapterExportCandidates.length
		};
		try {
			const service = new BatchExportService({
				onUpdate: (_item, progress) => {
					exportProgress = progress;
				}
			});
			const result = await service.runYouTubeChapters(
				chapterExportCandidates,
				exportOutputFolder,
				youtubeChaptersChoice,
				exportOnlyRecitation
			);
			if (result.failed > 0 || chapterExportCandidates.length < exportInspection.length) {
				toast.error(batchMessage('someProjectsCouldNotBeExported'));
			} else {
				toast.success(batchMessage('allEligibleProjectsExported'));
			}
		} catch (exportError) {
			queueError = String(exportError);
		} finally {
			workflow.finish('export');
		}
	}

	/**
	 * Exporte le JSON des sous-titres des projets cochés dans le dossier commun.
	 * @returns {Promise<void>} Promesse résolue après l'écriture de tous les fichiers.
	 */
	async function exportReadySubtitlesJson(): Promise<void> {
		if (subtitleExportCandidates.length === 0 || !exportOutputFolder || incompatibleQueueActive)
			return;
		showExportModal = false;
		if (!workflow.begin('export')) return;
		exportProgress = {
			activeProjectName: null,
			completed: 0,
			failed: 0,
			remaining: subtitleExportCandidates.length,
			total: subtitleExportCandidates.length
		};
		try {
			const service = new BatchExportService({
				onUpdate: (_item, progress) => {
					exportProgress = progress;
				}
			});
			const result = await service.runSubtitlesJson(subtitleExportCandidates, exportOutputFolder);
			if (result.failed > 0 || subtitleExportCandidates.length < exportInspection.length) {
				toast.error(batchMessage('someProjectsCouldNotBeExported'));
			} else {
				toast.success(batchMessage('allEligibleProjectsExported'));
			}
		} catch (exportError) {
			queueError = String(exportError);
		} finally {
			workflow.finish('export');
		}
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
	 * Rafraîchit le tableau sans remplacer la ligne encore mutée par le service.
	 * @param {BatchProjectItem} project Projet dont l'état vient de changer.
	 * @returns {void}
	 */
	function refreshProjectRow(project: BatchProjectItem): void {
		translationRowVersions[project.projectId] =
			(translationRowVersions[project.projectId] ?? 0) + 1;
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
	 * Traduit le statut d'une édition suivie dans une ligne Batch.
	 * @param {BatchTranslationStatus} status Statut persistant.
	 * @returns {string} Libellé localisé.
	 */
	function getTranslationStatusLabel(status: BatchTranslationStatus): string {
		const keys: Record<BatchTranslationStatus, string> = {
			not_added: 'translationNotAdded',
			adding: 'translationAdding',
			ready_to_fetch: 'translationReadyToFetch',
			fetching: 'translationFetching',
			auto_verified: 'translationAutoVerified',
			needs_review: 'translationNeedsReview',
			manually_verified: 'translationManuallyVerified',
			failed: 'translationFailed'
		};
		return batchMessage(keys[status]);
	}

	/**
	 * Rend active l'édition choisie dans le tableau et pour un éventuel retour de revue.
	 * @param {string} editionName Nom de l'édition.
	 * @param {boolean} updateSelection Réapplique la sélection par défaut de l'étape.
	 * @returns {void}
	 */
	function selectActiveTranslationEdition(
		editionName: string,
		updateSelection: boolean = true
	): void {
		activeTranslationEditionName = editionName;
		globalState.shared.batchTranslationEditionName = editionName;
		if (updateSelection && allSegmentationsVerified) {
			const actionableProjects = projects.filter((project) => {
				const state = project.translations[editionName];
				return !state || ['failed', 'ready_to_fetch', 'needs_review'].includes(state.status);
			});
			const defaults = actionableProjects.length > 0 ? actionableProjects : projects;
			workflow.replaceSelection(defaults.map((project) => project.projectId));
		}
	}

	/**
	 * Ajoute ou retire une édition de la sélection du modal Batch.
	 * @param {string} editionName Nom technique de l'édition.
	 * @returns {void}
	 */
	function toggleTranslationEdition(editionName: string): void {
		const next = new Set(selectedTranslationEditionNames);
		if (next.has(editionName)) next.delete(editionName);
		else next.add(editionName);
		selectedTranslationEditionNames = next;
	}

	/**
	 * Inspecte les projets sélectionnés avant d'ouvrir l'ajout d'éditions.
	 * @returns {Promise<void>} Résolution après le chargement des projets sélectionnés.
	 */
	async function openAddTranslationsModal(): Promise<void> {
		if (!allSegmentationsVerified || selectedProjects.length === 0 || incompatibleQueueActive)
			return;
		showAddTranslationsModal = true;
		translationModalLoading = true;
		translationSearch = '';
		selectedTranslationEditionNames = new Set();
		skipExistingTranslations = true;
		translationInspection = [];
		for (const item of selectedProjects) {
			if (!isBatchProjectSegmentationVerified(item)) {
				translationInspection.push({
					item,
					eligible: false,
					reason: 'segmentation',
					existingEditions: []
				});
				continue;
			}
			try {
				const project = await ProjectService.load(item.projectId);
				translationInspection.push({
					item,
					eligible: getProjectSubtitleClips(project).length > 0,
					reason: getProjectSubtitleClips(project).length > 0 ? null : 'subtitles',
					existingEditions: project.content.projectTranslation.addedTranslationEditions.map(
						(edition) => edition.name
					)
				});
			} catch {
				translationInspection.push({
					item,
					eligible: false,
					reason: 'project',
					existingEditions: []
				});
			}
		}
		translationInspection = [...translationInspection];
		translationModalLoading = false;
	}

	/**
	 * Lance l'ajout borné des éditions sélectionnées aux projets éligibles.
	 * @returns {Promise<void>} Résolution lorsque tous les workers sont terminés.
	 */
	async function startAddingTranslations(): Promise<void> {
		if (!batch || addEligibleProjects.length === 0 || selectedTranslationEditionNames.size === 0)
			return;
		const editions = allAvailableEditions.filter((edition) =>
			selectedTranslationEditionNames.has(edition.name)
		);
		if (editions.length === 0) return;
		showAddTranslationsModal = false;
		if (!workflow.begin('translation')) return;
		translationProgress.total = 0;
		queueError = '';
		selectActiveTranslationEdition(editions.at(-1)!.name, false);
		const service = new BatchTranslationService({
			onUpdate: (item, editionName) => {
				selectActiveTranslationEdition(editionName, false);
				refreshProjectRow(item);
			}
		});
		try {
			await service.addEditions(batch, addEligibleProjects, editions, skipExistingTranslations);
			batch = await BatchService.load(batch.id);
			selectActiveTranslationEdition(editions.at(-1)!.name);
		} catch (translationError) {
			queueError = String(translationError);
		} finally {
			workflow.finish('translation');
			revision++;
			await BatchService.loadUserBatchesDetails();
		}
	}

	/**
	 * Ouvre la confirmation du Fetch pour l'édition active uniquement.
	 * @returns {void}
	 */
	function openFetchTranslationsModal(): void {
		if (!activeTranslationEditionName || selectedProjects.length === 0 || incompatibleQueueActive)
			return;
		showFetchTranslationsModal = true;
	}

	/**
	 * Lance le Fetch borné pour l'édition active et les projets éligibles.
	 * @returns {Promise<void>} Résolution lorsque tous les workers sont terminés.
	 */
	async function startFetchingTranslations(): Promise<void> {
		if (!batch || !activeTranslationEditionName || fetchEligibleProjects.length === 0) return;
		showFetchTranslationsModal = false;
		if (!workflow.begin('translation')) return;
		queueError = '';
		const editionName = activeTranslationEditionName;
		const items = [...fetchEligibleProjects];
		translationProgress = {
			active: 0,
			completed: 0,
			failed: 0,
			skipped: 0,
			remaining: items.length,
			progress: 0,
			total: items.length
		};
		selectActiveTranslationEdition(editionName);
		const service = new BatchTranslationService({
			onUpdate: (item) => {
				refreshProjectRow(item);
			},
			onProgress: (progress) => (translationProgress = progress)
		});
		try {
			await service.fetchEdition(batch, items, editionName);
			batch = await BatchService.load(batch.id);
			selectActiveTranslationEdition(editionName);
		} catch (translationError) {
			queueError = String(translationError);
		} finally {
			workflow.finish('translation');
			revision++;
			await BatchService.loadUserBatchesDetails();
		}
	}

	/**
	 * Ajoute ou retire un projet de la sélection UI.
	 * @param {number} projectId Identifiant du projet.
	 * @returns {void}
	 */
	function toggleProject(projectId: number): void {
		workflow.toggleProject(projectId);
	}

	/**
	 * Sélectionne ou désélectionne toutes les lignes consultables.
	 * @returns {void}
	 */
	function toggleAll(): void {
		workflow.toggleAllProjects(projects);
	}

	/**
	 * Supprime définitivement les projets sélectionnés après confirmation.
	 * @returns {Promise<void>} Promesse résolue après la mise à jour du batch.
	 */
	async function deleteSelectedProjects(): Promise<void> {
		if (!batch || selectedProjects.length === 0 || incompatibleQueueActive) return;
		const projectIds = selectedProjects.map((project) => project.projectId);
		const confirmed = await ModalManager.confirmModal(
			batchMessage('deleteSelectedProjectsConfirm', { count: projectIds.length })
		);
		if (!confirmed) return;
		if (!workflow.begin('delete')) return;
		queueError = '';
		try {
			await BatchService.deleteProjects(batch, projectIds);
			workflow.replaceSelection([]);
			revision++;
		} catch (deleteError) {
			queueError = String(deleteError);
		} finally {
			workflow.finish('delete');
		}
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
		if (!workflow.begin('segmentation')) return;
		queueError = '';
		segmentationProgress = {
			active: 0,
			completed: 0,
			needsReview: 0,
			failed: 0,
			remaining: segmentationModalEligible.length,
			progress: 0,
			total: segmentationModalEligible.length
		};
		const eligibleProjectIds = new Set(
			segmentationModalEligible.map((result) => result.item.projectId)
		);
		const eligibleProjects = batch.projects.filter((project) =>
			eligibleProjectIds.has(project.projectId)
		);
		const service = new BatchSegmentationService({
			onUpdate: (project, activity, progress, live) => {
				segmentationActivities = new Map(segmentationActivities).set(project.projectId, activity);
				segmentationLive = new Map(segmentationLive).set(project.projectId, live);
				segmentationProgress = progress;
				refreshProjectRow(project);
			}
		});
		try {
			await service.run(batch, eligibleProjects, configuration, replaceExistingSubtitles);
			await notifyLongTaskCompletion({
				title: batchMessage('segmentationCompletedTitle'),
				body: batchMessage('segmentationCompletedBody', {
					completed: segmentationProgress.completed,
					needsReview: segmentationProgress.needsReview,
					failed: segmentationProgress.failed
				}),
				level: segmentationProgress.failed > 0 ? 'error' : 'success'
			});
			workflow.replaceSelection(
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
			workflow.finish('segmentation');
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
		if (!workflow.begin('media')) return;
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
			workflow.replaceSelection(defaults.map((project) => project.projectId));
		} catch (importError) {
			queueError = String(importError);
		} finally {
			workflow.finish('media');
			revision++;
			await BatchService.loadUserBatchesDetails();
		}
	}

	/**
	 * Convertit séquentiellement tous les médias principaux du Batch en CBR.
	 * @returns {Promise<void>} Promesse résolue lorsque toute la queue est terminale.
	 */
	async function convertAllAudioToCbr(): Promise<void> {
		if (!batch || !allMediaCompleted || cbrQueueActive) return;
		if (!workflow.begin('cbr')) return;
		queueError = '';
		cbrProgress = {
			activeProjectId: null,
			completed: 0,
			failed: 0,
			remaining: projects.length,
			progress: 0,
			total: projects.length
		};
		const service = new BatchCbrService({
			onUpdate: (_project, _activity, progress) => {
				cbrProgress = progress;
			}
		});
		try {
			cbrProgress = await service.run(batch, projects);
			if (cbrProgress.failed > 0) {
				toast.error(batchMessage('cbrCompletedWithFailures', { failed: cbrProgress.failed }));
			} else {
				toast.success(batchMessage('cbrCompleted'));
			}
		} finally {
			workflow.finish('cbr');
		}
	}

	/**
	 * Charge un projet enfant sans perdre l'identifiant du batch actif.
	 * @param {number} projectId Identifiant du projet à ouvrir.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture.
	 */
	async function openProject(projectId: number): Promise<void> {
		if (cbrQueueActive || translationQueueActive) return;
		const item = projects.find((project) => project.projectId === projectId);
		if (item?.media.status === 'processing' || item?.segmentation.status === 'processing') return;
		const project = await ProjectService.load(projectId);
		await MigrationService.HydrateStyleEditorUiMetadata(project);
		globalState.currentProject = project;
		discordService.setEditingState();
	}

	/**
	 * Ouvre le premier projet encore signalé selon l'ordre du batch.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture éventuelle.
	 */
	async function reviewFirstFlaggedProject(): Promise<void> {
		if (cbrQueueActive || translationQueueActive) return;
		const first = reviewProjects[0];
		if (batch && first && (await openBatchReviewProject(batch.id, first.projectId))) {
			discordService.setEditingState();
		}
	}

	/**
	 * Ouvre une revue Batch à partir de la ligne signalée choisie.
	 * @param {number} projectId Identifiant du projet à vérifier.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture.
	 */
	async function reviewProject(projectId: number): Promise<void> {
		if (!batch || cbrQueueActive || translationQueueActive) return;
		if (await openBatchReviewProject(batch.id, projectId)) discordService.setEditingState();
	}

	/**
	 * Ouvre une revue Batch pour l'édition active et la ligne choisie.
	 * @param {number} projectId Identifiant du projet à vérifier.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture.
	 */
	async function reviewTranslationProject(projectId: number): Promise<void> {
		if (!batch || !activeTranslationEditionName || incompatibleQueueActive) return;
		if (await openBatchTranslationReviewProject(batch.id, projectId, activeTranslationEditionName))
			discordService.setEditingState();
	}

	/**
	 * Ouvre une ligne dans le mode normal ou dans sa revue active.
	 * @param {BatchProjectItem} project Ligne Batch choisie.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture.
	 */
	async function openProjectRow(project: BatchProjectItem): Promise<void> {
		if (
			activeTranslationEditionName &&
			project.translations[activeTranslationEditionName]?.status === 'needs_review'
		) {
			await reviewTranslationProject(project.projectId);
		} else if (project.segmentation.status === 'needs_review') {
			await reviewProject(project.projectId);
		} else {
			await openProject(project.projectId);
		}
	}

	/**
	 * Démarre directement la seule revue disponible ou demande l'édition à cibler.
	 * @returns {Promise<void>} Promesse résolue après l'ouverture éventuelle.
	 */
	async function reviewTranslations(): Promise<void> {
		if (translationEditionsNeedingReview.length === 0) return;
		if (translationEditionsNeedingReview.length > 1) {
			showReviewEditionModal = true;
			return;
		}
		selectActiveTranslationEdition(translationEditionsNeedingReview[0]);
		const first = projects.find(
			(project) =>
				project.translations[translationEditionsNeedingReview[0]]?.status === 'needs_review'
		);
		if (first) await reviewTranslationProject(first.projectId);
	}

	onMount(async () => {
		if (globalState.currentBatchId === null) {
			error = get(LL).batch.noBatchSelected();
			return;
		}
		try {
			const loadedBatch = await BatchService.load(
				globalState.currentBatchId,
				batchMessage('mediaInterrupted')
			);
			await reconcileBatchSegmentations(loadedBatch);
			await reconcileBatchTranslations(loadedBatch);
			batch = loadedBatch;
			try {
				qdcTranslations = await QdcTranslationService.getAvailableTranslations(
					globalState.availableTranslations
				);
			} catch {
				qdcTranslations = globalState.qdcAvailableTranslations;
			}
			const editionNames = Array.from(
				new Set(batch.projects.flatMap((project) => Object.keys(project.translations)))
			);
			if (activeTranslationEditionName && editionNames.includes(activeTranslationEditionName)) {
				selectActiveTranslationEdition(activeTranslationEditionName);
			} else if (editionNames.length > 0) {
				selectActiveTranslationEdition(editionNames[0]);
			}
			if (!batch.projects.every(isBatchProjectSegmentationVerified)) {
				const defaults = batch.projects.filter(
					(project) =>
						project.media.status === 'pending' ||
						project.media.status === 'failed' ||
						(project.media.status === 'completed' &&
							(project.segmentation.status === 'not_started' ||
								project.segmentation.status === 'failed'))
				);
				workflow.replaceSelection(defaults.map((project) => project.projectId));
			} else if (!activeTranslationEditionName) {
				workflow.replaceSelection(batch.projects.map((project) => project.projectId));
			}
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
				<div class="flex w-full flex-wrap items-center gap-3">
					<div class="flex flex-wrap items-center justify-end gap-3" data-batch-context-actions>
						<span class="text-sm text-[var(--text-secondary)]">
							{batchMessage('selectedProjects', { count: selectedProjects.length })}
						</span>
						{#if !allMediaCompleted}
							<button
								class="btn-accent inline-flex h-11 items-center justify-center gap-2 px-5"
								type="button"
								disabled={eligibleSelected.length === 0 ||
									queueActive ||
									segmentationQueueActive ||
									cbrQueueActive ||
									globalOperationActive}
								onclick={openMediaModal}
							>
								<span class="material-icons-outlined leading-none">download</span>
								<span class="leading-none">{batchMessage('importMedia')}</span>
							</button>
						{/if}
						{#if allMediaCompleted && !allSegmentationsVerified}
							<button
								class="btn btn-icon inline-flex h-11 items-center justify-center gap-2 px-5"
								type="button"
								disabled={queueActive ||
									segmentationQueueActive ||
									cbrQueueActive ||
									globalOperationActive}
								onclick={convertAllAudioToCbr}
							>
								<span class="material-icons-outlined leading-none">graphic_eq</span>
								<span class="leading-none">{batchMessage('convertAllAudioToCbr')}</span>
							</button>
							<button
								class="btn btn-primary inline-flex h-11 items-center justify-center gap-2 px-5"
								type="button"
								disabled={segmentationSelected.length === 0 ||
									queueActive ||
									segmentationQueueActive ||
									cbrQueueActive ||
									globalOperationActive}
								onclick={openSegmentationModal}
							>
								<span class="material-icons-outlined leading-none">auto_fix_high</span>
								<span class="leading-none">{batchMessage('aiSegmentation')}</span>
							</button>
						{/if}
						{#if allMediaCompleted && allSegmentationsVerified}
							<button
								class="btn-accent inline-flex h-11 items-center justify-center gap-2 px-5"
								type="button"
								disabled={selectedProjects.length === 0 || incompatibleQueueActive}
								onclick={openAddTranslationsModal}
							>
								<span class="material-icons-outlined leading-none">playlist_add</span>
								<span class="leading-none">{batchMessage('addTranslationsToProjects')}</span>
							</button>
							<button
								class="btn btn-primary inline-flex h-11 items-center justify-center gap-2 px-5"
								type="button"
								disabled={!activeTranslationEditionName ||
									selectedProjects.length === 0 ||
									incompatibleQueueActive}
								onclick={openFetchTranslationsModal}
							>
								<span class="material-icons-outlined leading-none">cloud_sync</span>
								<span class="leading-none">{batchMessage('fetchTranslationsFromProjects')}</span>
							</button>
						{/if}
					</div>
					<div
						class="ml-auto flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1.5"
						data-batch-global-actions
						role="group"
						aria-label={batchMessage('globalActions')}
					>
						<button
							class="btn btn-icon inline-flex h-11 items-center justify-center gap-2 px-3"
							type="button"
							disabled={selectedProjects.length === 0 || incompatibleQueueActive}
							title={incompatibleQueueActive
								? batchMessage('anotherBatchOperationActive')
								: batchMessage('setBackgroundForSelectedProjects')}
							aria-label={batchMessage('setBackgroundForSelectedProjects')}
							onclick={openBackgroundModal}
						>
							<span class="material-icons-outlined leading-none">wallpaper</span>
							<span class="hidden leading-none xl:inline">{batchMessage('setBackground')}</span>
						</button>
						<button
							class="btn btn-icon inline-flex h-11 items-center justify-center gap-2 px-3"
							type="button"
							disabled={selectedProjects.length === 0 || incompatibleQueueActive}
							title={incompatibleQueueActive
								? batchMessage('anotherBatchOperationActive')
								: batchMessage('applyStyleToSelectedProjects')}
							aria-label={batchMessage('applyStyleToSelectedProjects')}
							onclick={openStyleModal}
						>
							<span class="material-icons-outlined leading-none">palette</span>
							<span class="hidden leading-none xl:inline">{batchMessage('applyStyle')}</span>
						</button>
						<button
							class="btn btn-primary inline-flex h-11 items-center justify-center gap-2 px-3"
							type="button"
							disabled={selectedProjects.length === 0 || incompatibleQueueActive}
							title={exportQueueActive
								? batchMessage('exportCurrentlyRunning')
								: incompatibleQueueActive
									? batchMessage('anotherBatchOperationActive')
									: batchMessage('exportSelectedProjects', {
											count: selectedProjects.length
										})}
							aria-label={batchMessage('exportSelectedProjects', {
								count: selectedProjects.length
							})}
							onclick={openExportModal}
						>
							<span class="material-icons-outlined leading-none">file_download</span>
							<span class="hidden leading-none xl:inline">{$LL.common.export()}</span>
						</button>
					</div>
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
			{#if styleQueueActive}
				<BatchProgressCard
					summary={batchMessage('applyingStyleProgress', {
						completed: styleProgress.completed,
						total: styleProgress.total,
						failed: styleProgress.failed
					})}
					progress={styleGlobalProgress}
				/>
			{/if}
			{#if exportQueueActive}
				<BatchProgressCard
					summary={batchMessage('exportingProjectsProgress', {
						completed: exportProgress.completed,
						total: exportProgress.total,
						failed: exportProgress.failed
					})}
					progress={exportGlobalProgress}
					detail={exportProgress.activeProjectName
						? batchMessage('currentExportProject', {
								project: exportProgress.activeProjectName
							})
						: null}
				/>
			{/if}
			{#if queueActive}
				<BatchProgressCard
					summary={batchMessage('queueSummary', {
						active: queueProgress.active,
						completed: queueProgress.completed,
						failed: queueProgress.failed,
						remaining: queueProgress.remaining
					})}
					progress={queueProgress.progress}
				/>
			{/if}
			{#if cbrQueueActive}
				<BatchProgressCard
					summary={cbrCurrentProject
						? batchMessage('cbrConvertingProject', { project: cbrCurrentProject.projectName })
						: batchMessage('cbrPreparing')}
					progress={cbrProgress.progress}
					detail={batchMessage('cbrQueueSummary', {
						completed: cbrProgress.completed,
						total: cbrProgress.total,
						failed: cbrProgress.failed
					})}
				/>
			{/if}
			{#if segmentationQueueActive}
				<BatchProgressCard
					summary={batchMessage('segmentationQueueSummary', {
						active: segmentationProgress.active,
						completed: segmentationProgress.completed,
						needsReview: segmentationProgress.needsReview,
						failed: segmentationProgress.failed,
						remaining: segmentationProgress.remaining
					})}
					progress={segmentationProgress.progress}
				/>
			{/if}
			{#if translationQueueActive && activeTranslationEditionName}
				<BatchProgressCard
					summary={batchMessage('translationQueueSummary', {
						completed:
							translationProgress.total > 0
								? translationProgress.completed +
									translationProgress.failed +
									translationProgress.skipped
								: activeTranslationStates.filter(
										(state) =>
											state &&
											[
												'ready_to_fetch',
												'auto_verified',
												'needs_review',
												'manually_verified'
											].includes(state.status)
									).length,
						total: translationProgress.total > 0 ? translationProgress.total : projects.length
					})}
					progress={translationGlobalProgress}
				/>
			{/if}
			{#if translationEditionNames.length > 0}
				<label class="flex max-w-md items-center gap-3 text-sm text-[var(--text-secondary)]">
					<span>{batchMessage('translationEdition')}</span>
					<select
						class="min-w-56 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-[var(--text-primary)]"
						value={activeTranslationEditionName ?? ''}
						onchange={(event) =>
							selectActiveTranslationEdition((event.currentTarget as HTMLSelectElement).value)}
					>
						{#each translationEditionNames as editionName (editionName)}
							<option value={editionName}>
								{projects.find((project) => project.translations[editionName])?.translations[
									editionName
								]?.editionAuthor ?? editionName}
							</option>
						{/each}
					</select>
				</label>
			{/if}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-sm text-[var(--text-secondary)]">
					{batchMessage('readyForTranslations', {
						ready: readyForTranslations,
						total: projects.length
					})}
				</p>
				<div class="ml-auto flex flex-wrap items-center gap-3">
					{#if reviewProjects.length > 0 && !allSegmentationsVerified}
						<button
							class="btn-accent inline-flex h-10 items-center justify-center gap-2 px-4"
							type="button"
							disabled={segmentationQueueActive || cbrQueueActive || globalOperationActive}
							onclick={reviewFirstFlaggedProject}
						>
							<span class="material-icons-outlined text-base leading-none">fact_check</span>
							<span class="leading-none">{batchMessage('reviewFlaggedProjects')}</span>
						</button>
					{/if}
					{#if translationEditionsNeedingReview.length > 0}
						<button
							class="btn-accent inline-flex h-10 items-center justify-center gap-2 px-4"
							type="button"
							disabled={incompatibleQueueActive}
							onclick={reviewTranslations}
						>
							<span class="material-icons-outlined text-base leading-none">fact_check</span>
							<span class="leading-none">{batchMessage('reviewTranslationProjects')}</span>
						</button>
					{/if}
					<button
						class="btn btn-icon danger-color inline-flex h-10 items-center justify-center gap-2 px-4"
						type="button"
						disabled={selectedProjects.length === 0 || incompatibleQueueActive}
						onclick={deleteSelectedProjects}
					>
						<span class="material-icons-outlined leading-none">delete</span>
						<span class="leading-none">{batchMessage('deleteSelectedProjects')}</span>
					</button>
				</div>
			</div>

			<BatchProjectTable
				{projects}
				stage={activeProjectStage}
				{activeTranslationEditionName}
				{selectedIds}
				{allSelected}
				operationActive={cbrQueueActive || translationQueueActive || globalOperationActive}
				{segmentationLive}
				rowVersions={translationRowVersions}
				{batchMessage}
				getMediaActivityLabel={getActivityLabel}
				{getModeLabel}
				{getSegmentationActivityLabel}
				{getSegmentationError}
				{getTranslationStatusLabel}
				onToggleAll={toggleAll}
				onToggleProject={toggleProject}
				onOpenProject={openProjectRow}
			/>
		{/if}
	</div>
</div>

{#if showBackgroundModal}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-lg rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-background-title"
		>
			<h2 id="batch-background-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('setBackground')}
			</h2>
			<p class="mt-2 text-sm text-[var(--text-secondary)]">
				{batchMessage('setBackgroundScope', { count: selectedProjects.length })}
			</p>
			<div class="mt-5 grid gap-3 sm:grid-cols-2">
				<button
					class="btn btn-icon inline-flex min-h-20 items-center justify-center gap-3 px-4"
					type="button"
					onclick={() => setSelectedProjectsBackground(AssetType.Image)}
				>
					<span class="material-icons-outlined">image</span>
					<span>{batchMessage('chooseBackgroundImage')}</span>
				</button>
				<button
					class="btn btn-icon inline-flex min-h-20 items-center justify-center gap-3 px-4"
					type="button"
					onclick={() => setSelectedProjectsBackground(AssetType.Video)}
				>
					<span class="material-icons-outlined">movie</span>
					<span>{batchMessage('chooseBackgroundVideo')}</span>
				</button>
			</div>
			<div class="mt-6 flex justify-end">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showBackgroundModal = false)}
				>
					{$LL.common.cancel()}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showStyleModal && batch}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-style-title"
		>
			<h2 id="batch-style-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('applyStyleToSelectedProjects')}
			</h2>
			<p class="mt-2 text-sm text-[var(--text-secondary)]">
				{batchMessage('selectSavedPreset')}
			</p>
			<div class="mt-5 max-h-72 space-y-2 overflow-y-auto">
				{#each savedStylePresets as preset (preset.id)}
					<label
						class="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-color)] p-3 hover:border-[var(--accent-primary)]"
					>
						<input
							type="radio"
							name="batch-style-preset"
							value={preset.id}
							bind:group={selectedStylePresetId}
						/>
						<span class="min-w-0">
							<span class="block truncate font-medium text-[var(--text-primary)]"
								>{preset.name}</span
							>
							<span class="block text-xs text-[var(--text-thirdly)]">
								{preset.resolution.width} × {preset.resolution.height} · {new Date(
									preset.updatedAt
								).toLocaleDateString()}
							</span>
						</span>
					</label>
				{:else}
					<p class="rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
						{batchMessage('noSavedPresets')}
					</p>
				{/each}
			</div>
			<p class="mt-4 rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
				{batchMessage('styleSelectedProjectsScope', { count: selectedProjects.length })}
			</p>
			<label class="mt-4 flex gap-3 text-sm text-[var(--text-secondary)]">
				<input type="checkbox" bind:checked={styleOverwriteConfirmed} />
				<span>{batchMessage('existingStylesReplaced')}</span>
			</label>
			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showStyleModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn-accent h-10 px-4"
					type="button"
					disabled={!selectedStylePreset || !styleOverwriteConfirmed}
					onclick={applyStyleToBatch}
				>
					{batchMessage('applyStyle')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showExportModal && batch}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-2xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-export-title"
		>
			<h2 id="batch-export-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('exportSelectedProjects', { count: selectedProjects.length })}
			</h2>
			<div class="mt-5 grid grid-cols-3 rounded-lg bg-[var(--bg-accent)] p-1">
				<button
					class:btn-accent={exportModalTab === 'video'}
					class="h-10 rounded-md px-4 text-sm"
					type="button"
					onclick={() => (exportModalTab = 'video')}
				>
					{$LL.export.videoExportOption()}
				</button>
				<button
					class:btn-accent={exportModalTab === 'youtube'}
					class="h-10 rounded-md px-4 text-sm"
					type="button"
					onclick={() => (exportModalTab = 'youtube')}
				>
					{$LL.export.youtubeChaptersOption()}
				</button>
				<button
					class:btn-accent={exportModalTab === 'subtitles'}
					class="h-10 rounded-md px-4 text-sm"
					type="button"
					onclick={() => (exportModalTab = 'subtitles')}
				>
					{$LL.export.subtitlesExportOption()}
				</button>
			</div>
			{#if exportModalTab === 'video'}
				<p class="mt-3 text-sm text-[var(--text-secondary)]">
					{batchMessage('usingEachProjectSavedSettings')}
				</p>
			{/if}
			{#if exportModalLoading}
				<p class="mt-5 rounded-lg bg-[var(--bg-accent)] p-4 text-[var(--text-secondary)]">
					{batchMessage('inspectingExportProjects')}
				</p>
			{:else if exportModalTab === 'video'}
				<div class="mt-5 grid grid-cols-2 gap-3">
					<p class="rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
						{batchMessage('readyToExport', { count: readyExports.length })}
					</p>
					<p class="rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
						{batchMessage('notReadyToExport', { count: ignoredExports.length })}
					</p>
				</div>
				{#if ignoredExports.length > 0}
					<ul class="mt-3 max-h-44 space-y-1 overflow-y-auto text-sm text-[var(--text-secondary)]">
						{#each ignoredExports as result (result.item.projectId)}
							<li>
								{result.item.projectName} — {batchMessage(`exportReason${result.reason}`)}
							</li>
						{/each}
					</ul>
					<label class="mt-4 flex gap-3 text-sm text-[var(--text-secondary)]">
						<input
							type="checkbox"
							bind:checked={exportNonReadyProjects}
							disabled={!ignoredExports.some(
								(result) => result.project !== null && result.reason !== 'EXPORT_ACTIVE'
							)}
						/>
						<span>
							<span class="block font-medium text-[var(--text-primary)]">
								{batchMessage('exportNonReadyProjects')}
							</span>
							<span class="mt-1 block text-xs text-[var(--text-thirdly)]">
								{batchMessage('exportNonReadyWarning')}
							</span>
						</span>
					</label>
				{/if}
			{:else if exportModalTab === 'youtube'}
				<div class="mt-5 space-y-3">
					<label
						class="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-accent)] p-4"
					>
						<input
							type="radio"
							name="batch-youtube-chapters"
							value="Each Surah"
							bind:group={youtubeChaptersChoice}
						/>
						<span>
							<span class="block font-medium text-[var(--text-primary)]">
								{$LL.export.chapterPerSurah()}
							</span>
							<span class="mt-1 block text-xs text-[var(--text-thirdly)]">
								{$LL.export.chapterPerSurahDescription()}
							</span>
						</span>
					</label>
					<label
						class="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-accent)] p-4"
					>
						<input
							type="radio"
							name="batch-youtube-chapters"
							value="Each Verse"
							bind:group={youtubeChaptersChoice}
						/>
						<span>
							<span class="block font-medium text-[var(--text-primary)]">
								{$LL.export.chapterPerVerse()}
							</span>
							<span class="mt-1 block text-xs text-[var(--text-thirdly)]">
								{$LL.export.chapterPerVerseDescription()}
							</span>
						</span>
					</label>
				</div>
			{:else}
				<p class="mt-5 rounded-lg bg-[var(--bg-accent)] p-4 text-sm text-[var(--text-secondary)]">
					{$LL.export.exportSubtitlesJsonButtonDescription()}
				</p>
			{/if}
			{#if !exportModalLoading}
				{#if exportModalTab !== 'subtitles'}
					<label class="mt-4 flex gap-3 text-sm text-[var(--text-secondary)]">
						<input type="checkbox" bind:checked={exportOnlyRecitation} />
						<span>
							<span class="block font-medium text-[var(--text-primary)]">
								{$LL.export.exportOnlyRecitation()}
							</span>
							<span class="mt-1 block text-xs text-[var(--text-thirdly)]">
								{$LL.export.exportOnlyRecitationDescription()}
							</span>
						</span>
					</label>
				{/if}
				<div class="mt-5">
					<p class="mb-2 text-sm text-[var(--text-secondary)]">
						{batchMessage('selectOutputFolder')}
					</p>
					<button class="btn btn-icon h-10 px-4" type="button" onclick={selectBatchExportFolder}>
						<span class="material-icons-outlined mr-2 text-base">folder_open</span>
						{batchMessage('selectOutputFolder')}
					</button>
					{#if exportOutputFolder}
						<p class="mt-2 break-all text-xs text-[var(--text-thirdly)]">{exportOutputFolder}</p>
					{/if}
				</div>
			{/if}
			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showExportModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				{#if exportModalTab === 'video'}
					<button
						class="btn-accent h-10 px-4"
						type="button"
						disabled={exportModalLoading || exportCandidates.length === 0 || !exportOutputFolder}
						onclick={exportReadyProjects}
					>
						{batchMessage(
							exportNonReadyProjects ? 'exportSelectedProjects' : 'exportReadyProjects',
							{ count: exportCandidates.length }
						)}
					</button>
				{:else if exportModalTab === 'youtube'}
					<button
						class="btn-accent h-10 px-4"
						type="button"
						disabled={exportModalLoading ||
							chapterExportCandidates.length === 0 ||
							!exportOutputFolder}
						onclick={exportReadyYouTubeChapters}
					>
						{$LL.export.exportYoutubeChaptersButton()}
					</button>
				{:else}
					<button
						class="btn-accent h-10 px-4"
						type="button"
						disabled={exportModalLoading ||
							subtitleExportCandidates.length === 0 ||
							!exportOutputFolder}
						onclick={exportReadySubtitlesJson}
					>
						{$LL.export.exportSubtitlesJsonButton()}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

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

{#if showAddTranslationsModal}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6">
		<div
			class="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-add-translations-title"
		>
			<h2
				id="batch-add-translations-title"
				class="text-xl font-semibold text-[var(--text-primary)]"
			>
				{batchMessage('addTranslationsToProjects')}
			</h2>
			<div class="mt-4 grid gap-3 sm:grid-cols-2">
				<p class="rounded-xl bg-[var(--bg-accent)] p-4 text-sm text-[var(--text-secondary)]">
					{batchMessage('translationSelectedProjects', { count: selectedProjects.length })}
				</p>
				<p class="rounded-xl bg-[var(--bg-accent)] p-4 text-sm text-[var(--text-secondary)]">
					{batchMessage('translationEligibleProjects', { count: addEligibleProjects.length })}
				</p>
			</div>
			{#if translationModalLoading}
				<p class="mt-4 text-sm text-[var(--text-secondary)]">
					{batchMessage('translationInspectingProjects')}
				</p>
			{:else}
				{#if translationInspection.some((result) => !result.eligible)}
					<div class="mt-4 rounded-xl border border-[var(--border-color)] p-4">
						<p class="font-medium text-[var(--text-primary)]">
							{batchMessage('translationIgnoredProjects')}
						</p>
						<ul class="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
							{#each translationInspection.filter((result) => !result.eligible) as result (result.item.projectId)}
								<li>
									{result.item.projectName} — {batchMessage(
										result.reason === 'segmentation'
											? 'translationReasonSegmentation'
											: result.reason === 'subtitles'
												? 'translationReasonSubtitles'
												: 'translationReasonProject'
									)}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				<input
					class="mt-4 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)]"
					placeholder={batchMessage('translationSearchEditions')}
					bind:value={translationSearch}
				/>
				<div class="mt-3 max-h-72 space-y-2 overflow-y-auto">
					{#each filteredAvailableEditions as edition (edition.name)}
						<label
							class="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border-color)] p-3 hover:border-[var(--accent-primary)]"
						>
							<input
								type="checkbox"
								checked={selectedTranslationEditionNames.has(edition.name)}
								onchange={() => toggleTranslationEdition(edition.name)}
							/>
							<span class="min-w-0">
								<span class="block truncate font-medium text-[var(--text-primary)]">
									{edition.author}
								</span>
								<span class="text-xs text-[var(--text-thirdly)]">{edition.language}</span>
							</span>
						</label>
					{/each}
				</div>
				{#if selectedTranslationEditionNames.size > 0}
					<p class="mt-4 rounded-lg bg-[var(--bg-accent)] p-3 text-sm text-[var(--text-secondary)]">
						{batchMessage('translationAlreadyAddedCount', {
							count: translationInspection.filter(
								(result) =>
									result.eligible &&
									Array.from(selectedTranslationEditionNames).some((editionName) =>
										result.existingEditions.includes(editionName)
									)
							).length
						})}
					</p>
				{/if}
				<label class="mt-4 flex items-center gap-3 text-sm text-[var(--text-primary)]">
					<input type="checkbox" bind:checked={skipExistingTranslations} />
					<span>{batchMessage('translationSkipExisting')}</span>
				</label>
				{#if !skipExistingTranslations}
					<p
						class="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200"
					>
						{batchMessage('translationReplaceWarning')}
					</p>
				{/if}
			{/if}
			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showAddTranslationsModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn btn-primary h-10 px-5"
					type="button"
					disabled={translationModalLoading ||
						addEligibleProjects.length === 0 ||
						selectedTranslationEditionNames.size === 0}
					onclick={startAddingTranslations}
				>
					{batchMessage('translationAdd')}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showFetchTranslationsModal && activeTranslationEditionName}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-fetch-translations-title"
		>
			<h2
				id="batch-fetch-translations-title"
				class="text-xl font-semibold text-[var(--text-primary)]"
			>
				{batchMessage('fetchTranslationsFromProjects')}
			</h2>
			<label class="mt-5 block text-sm text-[var(--text-secondary)]">
				<span>{batchMessage('translationEdition')}</span>
				<select
					class="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-[var(--text-primary)]"
					value={activeTranslationEditionName}
					onchange={(event) =>
						selectActiveTranslationEdition((event.currentTarget as HTMLSelectElement).value)}
				>
					{#each translationEditionNames as editionName (editionName)}
						<option value={editionName}>
							{projects.find((project) => project.translations[editionName])?.translations[
								editionName
							]?.editionAuthor ?? editionName}
						</option>
					{/each}
				</select>
			</label>
			<div
				class="mt-5 space-y-2 rounded-xl bg-[var(--bg-accent)] p-4 text-sm text-[var(--text-secondary)]"
			>
				<p>{batchMessage('translationSelectedProjects', { count: selectedProjects.length })}</p>
				<p>
					{batchMessage('translationEligibleProjects', { count: fetchEligibleProjects.length })}
				</p>
				<p>{batchMessage('translationPendingCount', { count: fetchPendingCount })}</p>
				<p>
					{batchMessage('translationMissingEditionCount', {
						count: selectedProjects.length - fetchEligibleProjects.length
					})}
				</p>
			</div>
			{#if selectedProjects.length > fetchEligibleProjects.length}
				<ul class="mt-3 space-y-1 text-sm text-[var(--text-thirdly)]">
					{#each selectedProjects.filter((project) => !project.translations[activeTranslationEditionName!]) as project (project.projectId)}
						<li>{project.projectName}</li>
					{/each}
				</ul>
			{/if}
			<div class="mt-6 flex justify-end gap-3">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showFetchTranslationsModal = false)}
				>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn btn-primary h-10 px-5"
					type="button"
					disabled={fetchEligibleProjects.length === 0}
					onclick={startFetchingTranslations}
				>
					{batchMessage('translationFetch')}
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

{#if showReviewEditionModal}
	<div class="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4">
		<div
			class="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-review-edition-title"
		>
			<h2 id="batch-review-edition-title" class="text-xl font-semibold text-[var(--text-primary)]">
				{batchMessage('selectTranslationEdition')}
			</h2>
			<div class="mt-4 space-y-2">
				{#each translationEditionsNeedingReview as editionName (editionName)}
					<button
						class="btn flex w-full items-center justify-between px-4 py-3 text-left"
						type="button"
						onclick={async () => {
							selectActiveTranslationEdition(editionName);
							showReviewEditionModal = false;
							const first = projects.find(
								(project) => project.translations[editionName]?.status === 'needs_review'
							);
							if (first) await reviewTranslationProject(first.projectId);
						}}
					>
						<span>
							{projects.find((project) => project.translations[editionName])?.translations[
								editionName
							]?.editionAuthor ?? editionName}
						</span>
						<span class="text-xs text-[var(--text-thirdly)]">
							{projects.filter(
								(project) => project.translations[editionName]?.status === 'needs_review'
							).length}
						</span>
					</button>
				{/each}
			</div>
			<div class="mt-6 flex justify-end">
				<button
					class="btn btn-icon h-10 px-4"
					type="button"
					onclick={() => (showReviewEditionModal = false)}
				>
					{$LL.common.cancel()}
				</button>
			</div>
		</div>
	</div>
{/if}
