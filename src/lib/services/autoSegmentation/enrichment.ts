import { invoke } from '@tauri-apps/api/core';
import type { RealignWindow, SegmentationResponse, SegmentationSegment } from './types';
import { getAutoSegmentationAudioInfo, getAutoSegmentationAudioClips } from './audio';
import { normalizeMfaSegments } from './parsing';

/**
 * Récupère les timestamps MFA pour une session cloud existante.
 *
 * @param {string} audioId Identifiant de session cloud.
 * @param {SegmentationSegment[]} segments Segments à enrichir.
 * @returns {Promise<SegmentationResponse>} Réponse MFA normalisée.
 */
export async function getSegmentationMfaTimestampsSession(
	audioId: string,
	segments: SegmentationSegment[]
): Promise<SegmentationResponse> {
	return (await invoke('get_segmentation_mfa_timestamps_session', {
		audioId,
		segments,
		granularity: 'words'
	})) as SegmentationResponse;
}

/**
 * Récupère les timestamps MFA à partir de l'audio courant du projet.
 *
 * @param {SegmentationSegment[]} segments Segments à enrichir.
 * @returns {Promise<SegmentationResponse>} Réponse MFA normalisée.
 */
export async function getSegmentationMfaTimestampsDirect(
	segments: SegmentationSegment[],
	window?: RealignWindow
): Promise<SegmentationResponse> {
	const audioInfo = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		throw new Error('No audio clip found in the project.');
	}

	return (await invoke('get_segmentation_mfa_timestamps_direct', {
		audioPath: audioInfo.filePath,
		audioClips: audioClips.map((clip) => ({
			path: clip.filePath,
			startMs: clip.startMs,
			endMs: clip.endMs
		})),
		segments,
		granularity: 'words',
		windowStartMs: window?.startMs,
		windowEndMs: window?.endMs
	})) as SegmentationResponse;
}

/**
 * Enrichit une réponse de segmentation avec des timestamps MFA quand ils sont absents.
 *
 * @param {SegmentationResponse} response Réponse brute ou partiellement enrichie.
 * @returns {Promise<SegmentationResponse>} Réponse avec mots MFA si disponibles.
 */
export async function enrichSegmentationResponseWithWordTimestamps(
	response: SegmentationResponse,
	window?: RealignWindow
): Promise<SegmentationResponse> {
	const segments = response.segments ?? [];
	if (segments.length === 0) return response;
	if (segments.every((segment) => (segment.words?.length ?? 0) > 0)) return response;

	try {
		let mfaSource: 'session' | 'direct';
		let mfaResponse: SegmentationResponse;
		if (response.audio_id) {
			try {
				mfaSource = 'session';
				mfaResponse = await getSegmentationMfaTimestampsSession(response.audio_id, segments);
			} catch (error) {
				console.warn(
					'[AutoSegmentation] MFA session enrichment failed, falling back to direct MFA:',
					error
				);
				mfaSource = 'direct';
				mfaResponse = await getSegmentationMfaTimestampsDirect(segments, window);
			}
		} else {
			mfaSource = 'direct';
			mfaResponse = await getSegmentationMfaTimestampsDirect(segments, window);
		}

		const mfaSegments = normalizeMfaSegments(mfaResponse.segments ?? [], segments);
		console.log('[AutoSegmentation] MFA timings payload:', {
			source: mfaSource,
			audioId: response.audio_id ?? mfaResponse.audio_id ?? null,
			segments: mfaSegments.map((segment) => ({
				segment: segment.segment,
				refFrom: segment.ref_from ?? null,
				refTo: segment.ref_to ?? null,
				words: (segment.words ?? []).map((word) => ({
					location: word.location,
					start: word.start,
					end: word.end,
					word: word.word ?? null
				}))
			}))
		});
		if (mfaSegments.length === 0) {
			console.warn('[AutoSegmentation] MFA enrichment returned no segments.', {
				source: mfaSource,
				audioId: response.audio_id ?? mfaResponse.audio_id ?? null
			});
			return response;
		}

		const mfaBySegment = new Map<number, SegmentationSegment>();
		for (const segment of mfaSegments) {
			if (segment.segment !== undefined) {
				mfaBySegment.set(segment.segment, segment);
			}
		}

		const enrichedResponse = {
			...response,
			audio_id: response.audio_id ?? mfaResponse.audio_id,
			segments: segments.map((segment, index) => {
				const segmentIndex = segment.segment;
				const mfaSegmentByIndex = mfaSegments[index];
				const mfaSegment =
					mfaSegmentByIndex ??
					(segmentIndex !== undefined ? mfaBySegment.get(segmentIndex) : undefined);
				if (!mfaSegment) return segment;
				return {
					...segment,
					words: mfaSegment.words ?? segment.words ?? []
				};
			})
		};

		const segmentsWithoutWords = (enrichedResponse.segments ?? [])
			.filter((segment) => (segment.words?.length ?? 0) === 0)
			.map((segment) => ({
				segment: segment.segment,
				refFrom: segment.ref_from ?? null,
				refTo: segment.ref_to ?? null
			}));
		if (segmentsWithoutWords.length > 0) {
			console.warn('[AutoSegmentation] Some segments still have no MFA word timestamps.', {
				source: mfaSource,
				segmentsWithoutWords
			});
		}

		return enrichedResponse;
	} catch (error) {
		console.warn('[AutoSegmentation] Failed to enrich segmentation with MFA timestamps:', error);
		return response;
	}
}
