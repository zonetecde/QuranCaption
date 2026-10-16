import type { AITranscriptCleanupState } from '$lib/classes/ProjectEditorState.svelte';
import { listen, type UnlistenFn, type EventCallback } from '@tauri-apps/api/event';
import type { Project } from '$lib/classes/Project';
import type { AITranscriptionSettings } from '$lib/classes/Settings.svelte';
import type {
	AITranscriptionResult,
	SpeakerNameMap,
	AIStreamBatchState
} from '$lib/types/transcription';
import { globalState } from '$lib/runes/main.svelte';
import {
	applyAITranscription,
	buildAITranscriptionFromSubtitleTrack,
	saveAITranscriptionSettings
} from '$lib/services/AITranscription';
import {
	cleanupAITranscript,
	estimateTranscriptCleanupBatchCount
} from '$lib/services/AITranscriptCleanup';
import { resolveAIReasoning } from '$lib/services/AIReasoning';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

const TRANSCRIPT_PREFERRED_GAP_SECONDS = 1.2;

/** Session de nettoyage indépendante de la modale, liée à un seul projet. */
export class TranscriptCleanupSession {
	result = $state<AITranscriptionResult | null>(null);
	speakerMap = $state<SpeakerNameMap>({});
	appliedClipIds = $state<number[]>([]);
	cleanupRunning = $state(false);
	cleanupPauseRequested = $state(false);
	cleanupCompleted = $state(false);
	cleanupMessage = $state('');
	cleanupErrors = $state<string[]>([]);
	cleanupBatchStreams = $state<Record<string, AIStreamBatchState>>({});
	semanticBatchStreams = $state<Record<string, AIStreamBatchState>>({});
	errorMessage = $state('');
	private cleanupChunkUnlisten: UnlistenFn | null = null;
	private cleanupReasoningUnlisten: UnlistenFn | null = null;
	private disposed = false;

	/**
	 * Capture le projet et ses réglages pour toute la durée du traitement.
	 * @param {Project} project Projet ouvert par la modale.
	 * @param {AITranscriptionSettings} settings Réglages de transcription.
	 */
	constructor(
		private readonly project: Project,
		private readonly settings: AITranscriptionSettings
	) {}

	/** @returns {number} Nombre de lots estimé pour le résultat courant. */
	get cleanupBatchCount(): number {
		return this.result
			? estimateTranscriptCleanupBatchCount(this.result, this.settings.cleanupBatchWords)
			: 0;
	}

	/** @returns {void} Lève une erreur si la session ne possède plus le projet actif. */
	ensureActive(): void {
		if (this.disposed || globalState.currentProject !== this.project)
			throw new Error(get(LL).common.unexpectedError());
	}

	/**
	 * Enregistre un abonnement en tenant compte d'une destruction pendant son ouverture.
	 * @param {string} event Nom d'événement Tauri.
	 * @param {EventCallback<T>} handler Récepteur de progression.
	 * @returns {Promise<UnlistenFn>} Fonction de désabonnement.
	 */
	async subscribe<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
		this.ensureActive();
		const unlisten = await listen<T>(event, handler);
		if (this.disposed || globalState.currentProject !== this.project) {
			unlisten();
			this.ensureActive();
		}
		return unlisten;
	}

	/** @returns {Promise<void>} Sauvegarde du projet qui possède la session. */
	async save(): Promise<void> {
		this.ensureActive();
		await this.project.save(false);
	}

	/**
	 * Applique le résultat dans une transaction du projet ayant démarré le traitement.
	 * @param {AITranscriptionResult} result Résultat nettoyé.
	 * @param {SpeakerNameMap} speakerMap Intervenants nommés.
	 * @param {boolean} replaceExisting Remplacement initial des clips.
	 * @param {number[]} clipIds Identifiants à remplacer.
	 * @returns {ReturnType<typeof applyAITranscription>} Clips effectivement appliqués.
	 */
	apply(
		result: AITranscriptionResult,
		speakerMap: SpeakerNameMap,
		replaceExisting: boolean,
		clipIds: number[] = []
	): ReturnType<typeof applyAITranscription> {
		this.ensureActive();
		return applyAITranscription(result, speakerMap, replaceExisting, clipIds, this.project);
	}

	/**
	 * Valide les intervenants et enregistre le résultat courant avant de changer d'étape.
	 * @returns {Promise<boolean>} Vrai lorsque les sous-titres sont appliqués et sauvegardés.
	 */
	async persistCurrentResult(): Promise<boolean> {
		if (!this.result) return false;
		try {
			this.ensureActive();
			for (const speakerId of this.result.speakers) {
				if (!this.speakerMap[speakerId]?.trim()) {
					this.errorMessage = get(LL).editor.chooseSpeakerBeforeCleanup({ speaker: speakerId });
					return false;
				}
			}
			const ids = new Set(this.appliedClipIds);
			const appliedClips = globalState.getSubtitleClips.filter((clip) => ids.has(clip.id));
			if (appliedClips.length === this.result.segments.length) {
				this.result = {
					...this.result,
					segments: this.result.segments.map((segment, index) => ({
						...segment,
						clipId: appliedClips[index].id,
						start: appliedClips[index].startTime / 1000,
						end: appliedClips[index].endTime / 1000
					}))
				};
			}
			this.appliedClipIds = this.apply(
				this.result,
				this.speakerMap,
				this.settings.replaceExisting,
				this.appliedClipIds
			).clipIds;
			await saveAITranscriptionSettings();
			await this.save();
			return true;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
			return false;
		}
	}

	/**
	 * Charge une reprise existante ou les sous-titres actuels pour un nettoyage après-coup.
	 * @returns {void}
	 */
	initializeCleanupOnly(): void {
		const pending = this.project.projectEditorState.subtitlesEditor.aiTranscriptCleanup;
		if (pending) {
			this.result = pending.sourceResult;
			this.speakerMap = pending.speakerMap;
			this.appliedClipIds = pending.appliedClipIds;
			this.settings.cleanupBatchWords = pending.batchWords;
			this.cleanupErrors = pending.errors;
			this.cleanupMessage = get(LL).editor.transcriptCleanupPaused({
				remaining: pending.totalBatches - pending.nextBatchIndex
			});
			return;
		}
		const snapshot = buildAITranscriptionFromSubtitleTrack();
		this.result = snapshot.result;
		this.speakerMap = snapshot.speakerMap;
		this.appliedClipIds = snapshot.clipIds;
	}

	/**
	 * Exécute ou reprend le nettoyage et ses sauvegardes sur le projet ayant ouvert la session.
	 * @returns {Promise<void>} Promesse résolue après arrêt ou achèvement du traitement.
	 */
	async startTranscriptCleanup(): Promise<void> {
		if (!this.result || this.cleanupRunning) return;
		const aiSettings = globalState.settings!.aiTranslationSettings;
		const editorState = this.project.projectEditorState.subtitlesEditor;
		const apiKey = aiSettings.openAiApiKey.trim();
		const endpoint = aiSettings.textAiApiEndpoint.trim();
		const model = aiSettings.advancedTrimModel.trim();
		if (!apiKey || !endpoint || !model) {
			this.errorMessage = get(LL).translations.aiTranslationProviderMissing();
			return;
		}
		let task = editorState.aiTranscriptCleanup;
		if (!task) {
			const snapshot = buildAITranscriptionFromSubtitleTrack();
			const ids = new Set(this.appliedClipIds);
			this.result = {
				...snapshot.result,
				segments: snapshot.result.segments.filter(
					(segment) => ids.size === 0 || ids.has(segment.clipId!)
				)
			};
			this.speakerMap = snapshot.speakerMap;
			task = {
				sourceResult: this.result,
				speakerMap: { ...this.speakerMap },
				analyses: [],
				errors: [],
				nextBatchIndex: 0,
				totalBatches: this.cleanupBatchCount,
				batchWords: this.settings.cleanupBatchWords,
				appliedClipIds: [...this.appliedClipIds]
			};
			this.setCheckpoint(task);
		}
		let activeTask = task;

		this.cleanupRunning = true;
		this.cleanupPauseRequested = false;
		this.cleanupCompleted = false;
		this.cleanupErrors = [];
		this.semanticBatchStreams = {};
		this.cleanupBatchStreams = Object.fromEntries(
			Array.from(
				{ length: Math.max(0, activeTask.totalBatches - activeTask.nextBatchIndex) },
				(_, index) => {
					const batchIndex = activeTask.nextBatchIndex + index + 1;
					const batchId = `pending-${batchIndex}`;
					return [
						batchId,
						{
							batchId,
							index: batchIndex,
							total: activeTask.totalBatches,
							status: 'pending',
							reasoning: '',
							response: ''
						} satisfies AIStreamBatchState
					];
				}
			)
		);
		this.cleanupMessage = get(LL).common.processing();
		this.errorMessage = '';
		try {
			await this.save();
			await saveAITranscriptionSettings();
			const reasoning = resolveAIReasoning(
				endpoint,
				model,
				aiSettings.transcriptCleanupReasoningMode
			);
			this.cleanupChunkUnlisten = await this.subscribe<{
				batchId: string;
				accumulatedText: string;
			}>('ai-transcript-cleanup-chunk', (event) => {
				const batch =
					this.cleanupBatchStreams[event.payload.batchId] ??
					this.semanticBatchStreams[event.payload.batchId];
				if (batch) batch.response = event.payload.accumulatedText;
			});
			this.cleanupReasoningUnlisten = await this.subscribe<{
				batchId: string;
				accumulatedText: string;
			}>('ai-transcript-cleanup-reasoning', (event) => {
				const batch =
					this.cleanupBatchStreams[event.payload.batchId] ??
					this.semanticBatchStreams[event.payload.batchId];
				if (batch) batch.reasoning = event.payload.accumulatedText;
			});
			const report = await cleanupAITranscript(activeTask.sourceResult, {
				apiKey,
				endpoint,
				model,
				reasoningEffort: reasoning.effort,
				thinkingEnabled: reasoning.thinkingEnabled,
				batchWords: activeTask.batchWords,
				maxWords: this.settings.maxWordsPerSegment,
				maxChars: this.settings.maxCharsPerSegment,
				maxGap: TRANSCRIPT_PREFERRED_GAP_SECONDS,
				resume: {
					analyses: activeTask.analyses,
					errors: activeTask.errors,
					nextBatchIndex: activeTask.nextBatchIndex
				},
				shouldPause: () => this.cleanupPauseRequested,
				onPreparationStart: () => {
					this.cleanupMessage = get(LL).editor.matchingQuranPassages();
				},
				onProgress: (current, total, batchId) => {
					delete this.cleanupBatchStreams[`pending-${current}`];
					this.cleanupBatchStreams[batchId] = {
						batchId,
						index: current,
						total,
						status: 'running',
						reasoning: '',
						response: ''
					};
					this.cleanupMessage = get(LL).editor.transcriptCleanupBatchProgress({ current, total });
				},
				onSemanticSegmentationStart: () => {
					this.cleanupMessage = get(LL).editor.transcriptSemanticSegmentation();
					this.semanticBatchStreams = {};
				},
				onSemanticSegmentationProgress: (current, total, batchId) => {
					this.semanticBatchStreams[batchId] = {
						batchId,
						index: current,
						total,
						status: 'running',
						reasoning: '',
						response: ''
					};
					this.cleanupMessage = get(LL).editor.transcriptSemanticSegmentation();
				},
				onSemanticSegmentationBatchComplete: (batchId) => {
					if (this.semanticBatchStreams[batchId]) {
						this.semanticBatchStreams[batchId].status = 'completed';
					}
				},
				onSemanticSegmentationBatchFailed: (batchId) => {
					if (this.semanticBatchStreams[batchId]) {
						this.semanticBatchStreams[batchId].status = 'failed';
					}
				},
				onFinalizationStart: () => {
					this.cleanupMessage = get(LL).editor.cleaningTranscript();
				},
				onValidationStart: () => {
					this.cleanupMessage = get(LL).editor.cleaningTranscript();
				},
				onBatchComplete: async (batchReport, batchId) => {
					if (this.cleanupBatchStreams[batchId]) {
						this.cleanupBatchStreams[batchId].status = 'completed';
					}
					this.result = batchReport.result;
					this.cleanupErrors = batchReport.errors;
					const applied = this.apply(
						batchReport.result,
						activeTask.speakerMap,
						false,
						activeTask.appliedClipIds
					);
					this.appliedClipIds = applied.clipIds;
					activeTask = {
						...activeTask,
						analyses: batchReport.analyses,
						errors: batchReport.errors,
						nextBatchIndex: batchReport.nextBatchIndex,
						totalBatches: batchReport.totalBatches,
						appliedClipIds: applied.clipIds
					};
					this.setCheckpoint(activeTask);
					await this.save();
				}
			});
			this.result = report.result;
			this.cleanupErrors = report.errors;
			if (report.paused) {
				activeTask = {
					...activeTask,
					analyses: report.analyses,
					errors: report.errors,
					nextBatchIndex: report.nextBatchIndex,
					totalBatches: report.totalBatches,
					appliedClipIds: [...this.appliedClipIds]
				};
				this.setCheckpoint(activeTask);
				this.cleanupMessage = get(LL).editor.transcriptCleanupPaused({
					remaining: report.totalBatches - report.nextBatchIndex
				});
				await this.save();
				return;
			}
			const applied = this.apply(
				report.result,
				activeTask.speakerMap,
				false,
				activeTask.appliedClipIds
			);
			this.appliedClipIds = applied.clipIds;
			this.cleanupCompleted = true;
			this.setCheckpoint(null);
			this.cleanupMessage =
				report.errors.length > 0
					? get(LL).editor.transcriptCleanupCompletedWithIssues({
							cleaned: report.processedSegments,
							total: report.processedSegments,
							errors: report.errors.length
						})
					: get(LL).editor.transcriptCleanupCompleted({
							cleaned: report.processedSegments,
							total: report.processedSegments
						});
			await this.save();
		} catch (error) {
			for (const batch of Object.values(this.cleanupBatchStreams)) {
				if (batch.status === 'running') batch.status = 'failed';
			}
			for (const batch of Object.values(this.semanticBatchStreams)) {
				if (batch.status === 'running') batch.status = 'failed';
			}
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.cleanupChunkUnlisten?.();
			this.cleanupChunkUnlisten = null;
			this.cleanupReasoningUnlisten?.();
			this.cleanupReasoningUnlisten = null;
			this.cleanupRunning = false;
		}
	}

	/**
	 * Demande l'arrêt du nettoyage après le batch en cours.
	 * @returns {void}
	 */
	pauseTranscriptCleanup(): void {
		this.cleanupPauseRequested = true;
	}

	/**
	 * Enregistre le point de reprise avec l'historique du projet.
	 * @param {AITranscriptCleanupState | null} task Traitement reprenable ou fin de traitement.
	 * @returns {void}
	 */
	setCheckpoint(task: AITranscriptCleanupState | null): void {
		this.ensureActive();
		ProjectHistoryManager.track('update transcript cleanup', () => {
			this.project.projectEditorState.subtitlesEditor.aiTranscriptCleanup = task;
		});
	}

	/** @returns {void} Arrête la planification et détache les événements lors de la fermeture. */
	dispose(): void {
		this.disposed = true;
		this.cleanupPauseRequested = true;
		this.cleanupChunkUnlisten?.();
		this.cleanupChunkUnlisten = null;
		this.cleanupReasoningUnlisten?.();
		this.cleanupReasoningUnlisten = null;
	}
}
