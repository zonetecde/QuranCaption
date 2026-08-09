import { invoke } from '@tauri-apps/api/core';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { globalState } from '$lib/runes/main.svelte';
import type {
	AutoSegmentationAudioClip,
	AutoSegmentationExecutionOptions,
	AutoSegmentationOptions,
	AutoSegmentationResult,
	LocalAsrMode,
	SegmentationDevice,
	SegmentationMode,
	SegmentationResponse
} from './types';
import type { SubtitleApplicationMode } from './types';
import {
	getAutoSegmentationAudioInfo,
	getAutoSegmentationAudioClips,
	getPreferredSegmentationMode
} from './audio';
import { parseSegmentationResponseFromThrownError } from './parsing';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { applySegmentationResponseToProject } from './apply-segmentation';
import {
	beginAudioNormalizationIfNeeded,
	normalizeAudioForProject
} from './audio-normalize.svelte';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';
import type { SubtitleTrack } from '$lib/classes/Track.svelte';
import {
	AutoSegmentationExecutionCoordinator,
	getAutoSegmentationBusyMessage
} from '$lib/services/AutoSegmentationExecutionCoordinator';

/**
 * Détecte les erreurs de quota GPU cloud qui justifient un retry sur CPU.
 *
 * @param {string} message Message d'erreur.
 * @param {SegmentationDevice} device Appareil courant.
 * @returns {boolean} True si un retry CPU est pertinent.
 */
function shouldRetryCloudOnCpu(message: string, device: SegmentationDevice): boolean {
	return (
		device === 'GPU' &&
		/GPU/i.test(message) &&
		/(quota exhausted|retry with device=CPU|daily limit)/i.test(message)
	);
}

/**
 * Détermine si les timestamps mot à mot sont requis pour cette exécution.
 * @param {boolean} requested Choix WBW enregistré.
 * @param {SubtitleApplicationMode} subtitleApplicationMode Mode d'application des sous-titres.
 * @returns {boolean} `true` si l'exécution doit demander les timestamps WBW.
 */
export function resolveIncludeWbwTimestamps(
	requested: boolean,
	subtitleApplicationMode: SubtitleApplicationMode
): boolean {
	return subtitleApplicationMode === 'align' || requested;
}

/**
 * Construit la charge utile de base pour une invocation de segmentation.
 *
 * @param {AutoSegmentationAudioInfo} audioInfo Infos audio.
 * @param {AutoSegmentationAudioClip[]} audioClips Clips audio.
 * @param {AutoSegmentationOptions} options Options de segmentation.
 * @returns {object} Charge utile de base.
 */
function buildBasePayload(
	audioInfo: { filePath: string; fileName: string; clipCount: number },
	audioClips: AutoSegmentationAudioClip[],
	options: AutoSegmentationOptions
) {
	return {
		audioPath: audioInfo.filePath,
		audioClips: audioClips.map((clip) => ({
			path: clip.filePath,
			startMs: clip.startMs,
			endMs: clip.endMs,
			sourceStartMs: clip.sourceStartMs
		})),
		minSilenceMs: options.minSilenceMs ?? 200,
		minSpeechMs: options.minSpeechMs ?? 1000,
		padMs: options.padMs ?? 100
	};
}

/**
 * Détermine le nom du modèle à stocker dans le contexte, selon le mode effectif.
 *
 * @param {SegmentationMode} effectiveMode Mode effectif.
 * @param {LocalAsrMode} localAsrMode Mode ASR local.
 * @param {string} cloudModel Nom du modèle cloud.
 * @param {string} multiAlignerModel Nom du modèle multi aligner.
 * @param {string} legacyWhisperModel Nom du modèle legacy whisper.
 * @returns {string} Nom du modèle contextuel.
 */
function resolveContextModelName(
	effectiveMode: SegmentationMode,
	localAsrMode: LocalAsrMode,
	cloudModel: string,
	multiAlignerModel: string,
	legacyWhisperModel: string
): string {
	if (effectiveMode === 'api') return cloudModel;
	if (localAsrMode === 'multi_aligner' || localAsrMode === 'surah_splitter')
		return multiAlignerModel;
	return legacyWhisperModel;
}

/**
 * Exécute la pipeline existante sur une instance de projet explicite.
 * @param {Project} project Projet cible, sans changement du projet global.
 * @param {AutoSegmentationOptions} options Options de segmentation.
 * @param {SegmentationMode} [mode] Mode de traitement ('api' ou 'local').
 * @param {AutoSegmentationExecutionOptions} executionOptions Effets UI et écrasement autorisés.
 * @returns {Promise<AutoSegmentationResult | null>} Résumé du résultat ou null en cas d'erreur.
 */
export async function runAutoSegmentationForProject(
	project: Project,
	options: AutoSegmentationOptions = {},
	mode?: SegmentationMode,
	executionOptions: AutoSegmentationExecutionOptions = {}
): Promise<AutoSegmentationResult | null> {
	const minSilenceMs: number = options.minSilenceMs ?? 200;
	const minSpeechMs: number = options.minSpeechMs ?? 1000;
	const padMs: number = options.padMs ?? 100;
	const subtitleApplicationMode: SubtitleApplicationMode =
		options.subtitleApplicationMode ?? 'replace';
	const includeWbwTimestamps = resolveIncludeWbwTimestamps(
		options.includeWbwTimestamps ?? false,
		subtitleApplicationMode
	);
	const localAsrMode: LocalAsrMode = options.localAsrMode ?? 'legacy_whisper';
	const legacyWhisperModel = options.legacyWhisperModel ?? 'base';
	const multiAlignerModel = options.multiAlignerModel ?? 'Base';
	const cloudModel = options.cloudModel ?? 'Base';
	const surahSplitterSurah = options.surahSplitterSurah ?? null;
	const device: SegmentationDevice = options.device ?? 'GPU';
	const hfToken: string = (options.hfToken ?? '').trim();
	const allowCloudFallback: boolean = options.allowCloudFallback ?? true;
	const fillBySilence: boolean = options.fillBySilence ?? true;
	const extendBeforeSilence: boolean = options.extendBeforeSilence ?? false;
	const extendBeforeSilenceMs: number = options.extendBeforeSilenceMs ?? 0;
	const onRunConfirmed = options.onRunConfirmed ?? null;

	const requestedMode: SegmentationMode = mode ?? (await getPreferredSegmentationMode());
	const allowCloudFallbackEffective: boolean = allowCloudFallback && requestedMode !== 'local';
	let effectiveMode: SegmentationMode = requestedMode;
	let fallbackToCloud = false;
	let cloudGpuFallbackToCpu = false;

	console.log(
		`[AutoSegmentation] requestedMode=${requestedMode} localAsrMode=${localAsrMode} device=${device} allowCloudFallback=${allowCloudFallbackEffective}`
	);

	const audioInfo = getAutoSegmentationAudioInfo(project);
	const audioClips = getAutoSegmentationAudioClips(project);
	if (!audioInfo || audioClips.length === 0) {
		return { status: 'failed', message: 'No audio clip found in the project.' };
	}

	// Re-timing audio en parallèle de la segmentation (point d'attente : apply).
	const audioNormalizationPromise = executionOptions.headless
		? normalizeAudioForProject(project)
		: undefined;
	if (!executionOptions.headless) beginAudioNormalizationIfNeeded();

	const subtitleTrack = project.content.timeline.getFirstTrack(TrackType.Subtitle) as SubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		if (executionOptions.headless && executionOptions.overwriteExistingSubtitles !== true) {
			return { status: 'cancelled' };
		}
	}

	if (onRunConfirmed) {
		await onRunConfirmed();
	}

	try {
		const basePayload = buildBasePayload(audioInfo, audioClips, {
			minSilenceMs,
			minSpeechMs,
			padMs
		});

		// Fonctions d'invocation
		const invokeCloudWithDevice = async (targetDevice: SegmentationDevice): Promise<unknown> =>
			await invoke('segment_quran_audio', {
				...basePayload,
				modelName: cloudModel,
				device: targetDevice
			});

		const invokeCloud = async (): Promise<unknown> => await invokeCloudWithDevice(device);

		const invokeLocalWithDevice = async (targetDevice: SegmentationDevice): Promise<unknown> => {
			if (localAsrMode === 'legacy_whisper') {
				return await invoke('segment_quran_audio_local', {
					...basePayload,
					whisperModel: legacyWhisperModel
				});
			}

			if (localAsrMode === 'surah_splitter') {
				return await invoke('segment_quran_audio_local_surah_splitter', {
					...basePayload,
					modelName: multiAlignerModel,
					device: targetDevice,
					surah: surahSplitterSurah,
					includeWbwTimestamps
				});
			}

			if (localAsrMode === 'quran_word_timing') {
				return await invoke('segment_quran_audio_local_word_timing', {
					...basePayload
				});
			}

			return await invoke('segment_quran_audio_local_multi', {
				...basePayload,
				modelName: multiAlignerModel,
				device: targetDevice,
				hfToken
			});
		};

		const invokeLocal = async (): Promise<unknown> => await invokeLocalWithDevice(device);

		let fallbackWarning: string | undefined;
		let payload: unknown;

		// Exécution du mode choisi
		if (effectiveMode === 'api') {
			try {
				payload = await invokeCloud();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				if (shouldRetryCloudOnCpu(errorMessage, device)) {
					console.warn(
						'[AutoSegmentation] Cloud GPU run failed, retrying once on CPU:',
						errorMessage
					);
					payload = await invokeCloudWithDevice('CPU');
					cloudGpuFallbackToCpu = true;
				} else {
					throw error;
				}
			}
		} else {
			// Mode local
			try {
				payload = await invokeLocal();
			} catch (localError) {
				const localMessage = localError instanceof Error ? localError.message : String(localError);
				if (!allowCloudFallbackEffective) {
					const recoveredResponse = parseSegmentationResponseFromThrownError(localError);
					if ((recoveredResponse?.segments?.length ?? 0) > 0) {
						console.warn(
							'[AutoSegmentation] Local mode returned partial payload via thrown error; continuing with recovered segments.'
						);
						payload = recoveredResponse;
					} else {
						console.warn('[AutoSegmentation] Local mode failed (no cloud fallback):', localError);
						throw localError;
					}
				} else {
					console.warn(
						'[AutoSegmentation] Local mode failed, falling back to cloud:',
						localMessage
					);
					fallbackWarning = `Local mode failed and was switched to Cloud: ${localMessage}`;
					fallbackToCloud = true;
					effectiveMode = 'api';
					payload = await invokeCloud();
				}
			}
		}

		if (effectiveMode === 'local') {
			console.log('[AutoSegmentation] Local segmentation raw response:', payload);
		}

		const rawResponse: SegmentationResponse = payload as SegmentationResponse;

		// Retry GPU→CPU sur réponse d'erreur
		if (
			effectiveMode === 'api' &&
			!cloudGpuFallbackToCpu &&
			rawResponse.error &&
			shouldRetryCloudOnCpu(rawResponse.error, device)
		) {
			console.warn(
				'[AutoSegmentation] Cloud GPU payload reported a quota error, retrying once on CPU:',
				rawResponse.error
			);
			payload = await invokeCloudWithDevice('CPU');
			cloudGpuFallbackToCpu = true;
		}

		const finalRawResponseBase: SegmentationResponse = cloudGpuFallbackToCpu
			? (payload as SegmentationResponse)
			: rawResponse;
		const response = includeWbwTimestamps
			? await enrichSegmentationResponseWithWordTimestamps(finalRawResponseBase)
			: finalRawResponseBase;

		const contextModelName = resolveContextModelName(
			effectiveMode,
			localAsrMode,
			cloudModel,
			multiAlignerModel,
			legacyWhisperModel
		);

		executionOptions.onApplying?.();
		return await applySegmentationResponseToProject({
			response,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs,
			fallbackToCloud,
			cloudGpuFallbackToCpu,
			requestedMode,
			effectiveMode,
			segmentationSource: effectiveMode === 'api' ? 'api' : 'local',
			includeWbwTimestamps,
			subtitleApplicationMode,
			modelName: contextModelName,
			device,
			warningOverride: fallbackWarning,
			payloadForLog: payload,
			project,
			headless: executionOptions.headless,
			audioNormalizationPromise
		});
	} catch (error) {
		console.error('Segmentation request failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message: errorMessage };
	}
}

/**
 * Lance la segmentation manuelle du projet actuellement ouvert avec un verrou partagé.
 * @param {AutoSegmentationOptions} options Options de segmentation.
 * @param {SegmentationMode} [mode] Mode de traitement.
 * @returns {Promise<AutoSegmentationResult | null>} Résultat de la segmentation.
 */
export async function runAutoSegmentation(
	options: AutoSegmentationOptions = {},
	mode?: SegmentationMode
): Promise<AutoSegmentationResult | null> {
	const release = AutoSegmentationExecutionCoordinator.tryAcquire('manual');
	if (!release) {
		return { status: 'failed', message: getAutoSegmentationBusyMessage() };
	}

	try {
		const project = globalState.currentProject;
		if (!project) return { status: 'failed', message: get(LL).home.anErrorOccurred() };
		return await runAutoSegmentationForProject(project, options, mode);
	} finally {
		release();
	}
}
