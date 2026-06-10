import { invoke } from '@tauri-apps/api/core';
import ModalManager from '$lib/components/modals/ModalManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { globalState } from '$lib/runes/main.svelte';
import type {
	AutoSegmentationOptions,
	AutoSegmentationResult,
	LocalAsrMode,
	SegmentationDevice,
	SegmentationMode,
	SegmentationResponse
} from './types';
import {
	getAutoSegmentationAudioInfo,
	getAutoSegmentationAudioClips,
	getPreferredSegmentationMode
} from './audio';
import { parseSegmentationResponseFromThrownError } from './parsing';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { applySegmentationResponseToProject } from './apply-segmentation';
import { beginAudioNormalizationIfNeeded } from './audio-normalize.svelte';

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
 * Détecte les crashs locaux Muaalem qui justifient un retry silencieux sur CPU.
 *
 * @param {string} message Message d'erreur.
 * @param {LocalAsrMode} localAsrMode Mode ASR local courant.
 * @param {SegmentationDevice} device Appareil courant.
 * @returns {boolean} True si un retry CPU est pertinent.
 */
function shouldRetryMuaalemOnCpu(
	message: string,
	localAsrMode: LocalAsrMode,
	device: SegmentationDevice
): boolean {
	return (
		localAsrMode === 'muaalem_local' &&
		device === 'GPU' &&
		/Python script failed with no output/i.test(message)
	);
}

/**
 * Indique si une liste de mots Muaalem semble déjà exprimée relativement au segment.
 *
 * @param {number} segmentStart Début du segment en secondes sur l'audio global.
 * @param {number} segmentEnd Fin du segment en secondes sur l'audio global.
 * @param {Array<{ start: number; end: number }>} words Liste des mots du segment.
 * @returns {boolean} True si les mots semblent déjà relatifs au segment.
 */
function hasRelativeMuaalemWordTimings(
	segmentStart: number,
	segmentEnd: number,
	words: Array<{ start: number; end: number }>
): boolean {
	if (words.length === 0) return true;

	const epsilon = 0.001;
	const segmentDuration = Math.max(0, segmentEnd - segmentStart);
	const minStart = Math.min(...words.map((word) => word.start));
	const maxEnd = Math.max(...words.map((word) => word.end));

	if (minStart <= epsilon && maxEnd <= segmentDuration + epsilon) return true;
	return maxEnd <= segmentDuration + epsilon && minStart < segmentStart - epsilon;
}

/**
 * Reconstruit les fins de mots Muaalem à partir du start du mot suivant.
 *
 * @param {number} segmentDuration Durée totale du segment en secondes.
 * @param {Array<{ start: number; end: number; location: string; word: string }>} words Liste des mots.
 * @returns {Array<{ start: number; end: number; location: string; word: string }>} Liste avec fins reconstruites.
 */
function rebuildMuaalemWordEnds(
	segmentDuration: number,
	words: Array<{ start: number; end: number; location: string; word?: string }>
): Array<{ start: number; end: number; location: string; word?: string }> {
	const normalizedWords = words.map((word) => ({
		...word,
		start: Math.max(0, word.start),
		end: Math.max(0, word.end)
	}));

	let previousEnd = 0;
	for (let index = 0; index < normalizedWords.length; index += 1) {
		const currentWord = normalizedWords[index];
		if (currentWord.start < previousEnd) {
			currentWord.start = previousEnd;
		}

		const nextRawStart = normalizedWords[index + 1]?.start ?? segmentDuration;
		currentWord.end = Math.max(currentWord.start, Math.min(segmentDuration, nextRawStart));
		previousEnd = currentWord.end;
	}

	return normalizedWords;
}

/**
 * Normalise les timestamps WBW Muaalem en temps relatifs au segment quand n?cessaire.
 *
 * @param {SegmentationResponse} response R?ponse brute de segmentation.
 * @returns {SegmentationResponse} R?ponse avec mots normalis?s.
 */
function normalizeMuaalemWordTimings(response: SegmentationResponse): SegmentationResponse {
	return {
		...response,
		segments: (response.segments ?? []).map((segment) => {
			const segmentStart = segment.time_from ?? 0;
			const segmentEnd = segment.time_to ?? segmentStart;
			const segmentDuration = Math.max(0, segmentEnd - segmentStart);
			const words = segment.words ?? [];
			if (hasRelativeMuaalemWordTimings(segmentStart, segmentEnd, words)) {
				return {
					...segment,
					words: rebuildMuaalemWordEnds(segmentDuration, words)
				};
			}
			return {
				...segment,
				words: rebuildMuaalemWordEnds(
					segmentDuration,
					words.map((word) => ({
						...word,
						start: Math.max(0, word.start - segmentStart),
						end: Math.max(0, word.end - segmentStart)
					}))
				)
			};
		})
	};
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
	audioClips: { filePath: string; fileName: string; startMs: number; endMs: number }[],
	options: AutoSegmentationOptions
) {
	return {
		audioPath: audioInfo.filePath,
		audioClips: audioClips.map((clip) => ({
			path: clip.filePath,
			startMs: clip.startMs,
			endMs: clip.endMs
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
	if (
		localAsrMode === 'multi_aligner' ||
		localAsrMode === 'muaalem_local' ||
		localAsrMode === 'surah_splitter'
	)
		return multiAlignerModel;
	return legacyWhisperModel;
}

/**
 * Applique la sortie de segmentation au projet.
 *
 * Étapes :
 * - Confirmer l'écrasement si des sous-titres existent déjà
 * - Invoquer la commande Rust (rééchantillonnage + API de segmentation)
 * - Convertir les segments en SubtitleClip / PredefinedSubtitleClip
 * - Normaliser les petits gaps et insérer les clips de silence
 * - Rafraîchir l'UI du projet et retourner le résumé
 *
 * @param {AutoSegmentationOptions} options Options de segmentation.
 * @param {SegmentationMode} [mode] Mode de traitement ('api' ou 'local').
 *   Si non spécifié, utilise le mode préféré.
 * @returns {Promise<AutoSegmentationResult | null>} Résumé du résultat ou null en cas d'erreur.
 */
export async function runAutoSegmentation(
	options: AutoSegmentationOptions = {},
	mode?: SegmentationMode
): Promise<AutoSegmentationResult | null> {
	const minSilenceMs: number = options.minSilenceMs ?? 200;
	const minSpeechMs: number = options.minSpeechMs ?? 1000;
	const padMs: number = options.padMs ?? 100;
	const includeWbwTimestamps: boolean = options.includeWbwTimestamps ?? false;
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

	const audioInfo = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		return { status: 'failed', message: 'No audio clip found in the project.' };
	}

	// Re-timing audio en parallèle de la segmentation (point d'attente : apply).
	beginAudioNormalizationIfNeeded();

	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite: boolean = await ModalManager.confirmModal(
			get(LL).editor.subtitlesAlreadyExist(),
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
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

			if (localAsrMode === 'muaalem_local') {
				return await invoke('segment_quran_audio_local_muaalem', {
					...basePayload,
					modelName: multiAlignerModel,
					device: targetDevice,
					includeWbwTimestamps
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
				if (shouldRetryMuaalemOnCpu(localMessage, localAsrMode, device)) {
					console.warn(
						'[AutoSegmentation] Muaalem local GPU run crashed, retrying once on CPU:',
						localMessage
					);
					payload = await invokeLocalWithDevice('CPU');
				} else if (!allowCloudFallbackEffective) {
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
		const finalRawResponse: SegmentationResponse =
			localAsrMode === 'muaalem_local'
				? normalizeMuaalemWordTimings(finalRawResponseBase)
				: finalRawResponseBase;
		const response = includeWbwTimestamps
			? await enrichSegmentationResponseWithWordTimestamps(finalRawResponse)
			: finalRawResponse;

		const contextModelName = resolveContextModelName(
			effectiveMode,
			localAsrMode,
			cloudModel,
			multiAlignerModel,
			legacyWhisperModel
		);

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
			modelName: contextModelName,
			device,
			warningOverride: fallbackWarning,
			payloadForLog: payload
		});
	} catch (error) {
		console.error('Segmentation request failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message: errorMessage };
	}
}
