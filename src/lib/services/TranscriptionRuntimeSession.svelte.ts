import type { UnlistenFn } from '@tauri-apps/api/event';
import { tick } from 'svelte';
import type { AITranscriptionSettings } from '$lib/classes/Settings.svelte';
import type { AITranscriptionRuntimeStatus } from '$lib/types/transcription';
import type { TranscriptCleanupSession } from './TranscriptCleanupSession.svelte';
import {
	buildDefaultSpeakerMap,
	checkAITranscriptionStatus,
	installAITranscriptionRuntime,
	runAITranscription,
	saveAITranscriptionSettings
} from './AITranscription';
import { cleanupAITranscript } from './AITranscriptCleanup';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

const TRANSCRIPT_PREFERRED_GAP_SECONDS = 1.2;

/** Pilote le moteur vocal et sa progression sans dépendre du cycle de rendu de la modale. */
export class TranscriptionRuntimeSession {
	runtimeStatus = $state<AITranscriptionRuntimeStatus | null>(null);
	checkingRuntime = $state(false);
	installing = $state(false);
	running = $state(false);
	installMessage = $state('');
	runMessage = $state('');
	progress = $state<number | null>(null);
	private statusUnlisten: UnlistenFn | null = null;
	private installUnlisten: UnlistenFn | null = null;

	/**
	 * Lie le moteur vocal aux réglages et à la session applicative du projet.
	 * @param {AITranscriptionSettings} settings Réglages du fournisseur vocal.
	 * @param {TranscriptCleanupSession} session Session propriétaire des sous-titres.
	 */
	constructor(
		private readonly settings: AITranscriptionSettings,
		private readonly session: TranscriptCleanupSession
	) {}

	/** @returns {Promise<void>} Actualise les capacités du moteur local. */
	async refreshRuntime(): Promise<void> {
		this.checkingRuntime = true;
		this.session.errorMessage = '';
		try {
			this.runtimeStatus = await checkAITranscriptionStatus();
		} catch (error) {
			this.runtimeStatus = null;
			this.session.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.checkingRuntime = false;
		}
	}

	/** @returns {Promise<boolean>} Indique si le moteur local est prêt après installation. */
	async installRuntime(): Promise<boolean> {
		if (this.installing) return false;
		this.installing = true;
		this.session.errorMessage = '';
		this.installMessage = get(LL).editor.preparingLabel();
		try {
			this.installUnlisten = await this.session.subscribe<{ message?: string }>(
				'install-status',
				(event) => {
					if (event.payload.message) this.installMessage = event.payload.message;
				}
			);
			await installAITranscriptionRuntime(this.settings.hfToken);
			await this.refreshRuntime();
			return true;
		} catch (error) {
			this.session.errorMessage = error instanceof Error ? error.message : String(error);
			return false;
		} finally {
			this.installUnlisten?.();
			this.installUnlisten = null;
			this.installing = false;
			this.installMessage = '';
		}
	}

	/**
	 * Transcrit puis applique le résultat au projet capturé par la session.
	 * @param {string} groqApiKey Clé du fournisseur cloud, si sélectionné.
	 * @param {string} [referenceText] Texte lu utilisé par le mode alignement.
	 * @returns {Promise<boolean>} Indique si les sous-titres ont été appliqués.
	 */
	async startTranscription(groqApiKey: string, referenceText = ''): Promise<boolean> {
		if (this.running) return false;
		this.running = true;
		this.session.result = null;
		this.session.cleanupCompleted = false;
		this.session.cleanupErrors = [];
		this.session.speakerMap = {};
		this.session.errorMessage = '';
		this.runMessage =
			this.settings.provider === 'groq'
				? get(LL).editor.groqPreparingAudio()
				: get(LL).editor.preparingLabel();
		this.progress = 0;
		try {
			await saveAITranscriptionSettings();
			this.statusUnlisten = await this.session.subscribe<{
				message?: string;
				phase?: string;
				progress?: number;
			}>('segmentation-status', (event) => {
				const groqMessages: Record<string, string> = {
					groq_prepare: get(LL).editor.groqPreparingAudio(),
					groq_transcribe: get(LL).editor.groqTranscribing(),
					groq_timestamps: get(LL).editor.groqPreparingTimestamps(),
					groq_complete: get(LL).editor.groqTranscriptionCompleted()
				};
				this.runMessage =
					groqMessages[event.payload.phase ?? ''] ?? event.payload.message ?? this.runMessage;
				if (typeof event.payload.progress === 'number') this.progress = event.payload.progress;
			});
			const transcription = await runAITranscription(
				this.session.project,
				this.settings,
				groqApiKey,
				referenceText
			);
			this.session.ensureActive();
			this.runMessage =
				this.settings.provider === 'alignment'
					? get(LL).common.processing()
					: get(LL).editor.matchingQuranPassages();
			this.progress = 100;
			await tick();
			// Le texte fourni doit rester intact ; le nettoyage reste une action facultative.
			const quranReport =
				this.settings.provider === 'alignment'
					? { result: transcription, errors: [] }
					: await cleanupAITranscript(transcription, {
							maxWords: this.settings.maxWordsPerSegment,
							maxChars: this.settings.maxCharsPerSegment,
							maxGap: TRANSCRIPT_PREFERRED_GAP_SECONDS,
							onPreparationStart: () => {
								this.runMessage = get(LL).editor.matchingQuranPassages();
								this.progress = 100;
							},
							onSemanticSegmentationStart: () => {
								this.runMessage = get(LL).editor.transcriptSemanticSegmentation();
								this.progress = 100;
							},
							onFinalizationStart: () => {
								this.runMessage = get(LL).editor.cleaningTranscript();
								this.progress = 100;
							},
							onValidationStart: () => {
								this.runMessage = get(LL).editor.cleaningTranscript();
								this.progress = 100;
							}
						});
			this.session.ensureActive();
			this.session.result = quranReport.result;
			this.session.cleanupErrors = quranReport.errors;
			this.session.setCheckpoint(null);
			this.session.speakerMap = buildDefaultSpeakerMap(this.session.project, this.session.result);
			this.runMessage = get(LL).common.processing();
			this.progress = 100;
			await tick();
			const applied = this.session.apply(
				this.session.result,
				this.session.speakerMap,
				this.settings.replaceExisting
			);
			this.session.appliedClipIds = applied.clipIds;
			await this.session.save();
			return true;
		} catch (error) {
			this.session.errorMessage = error instanceof Error ? error.message : String(error);
			return false;
		} finally {
			this.statusUnlisten?.();
			this.statusUnlisten = null;
			this.running = false;
			this.progress = null;
		}
	}

	/** @returns {void} Détache les abonnements de progression du moteur vocal. */
	dispose(): void {
		this.statusUnlisten?.();
		this.statusUnlisten = null;
		this.installUnlisten?.();
		this.installUnlisten = null;
	}
}
