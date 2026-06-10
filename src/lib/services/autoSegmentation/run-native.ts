import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { Quran } from '$lib/classes/Quran';
import { AssetClip, PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { VerseRange } from '$lib/classes/VerseRange.svelte';
import { Mp3QuranService } from '$lib/services/Mp3QuranService';
import { QdcRecitationService } from '$lib/services/QdcRecitationService';
import ModalManager from '$lib/components/modals/ModalManager';
import type { AutoSegmentationResult } from './types';
import { closeSmallSubtitleGaps, insertSilenceClips } from './timeline';
import { beginAudioNormalizationIfNeeded, awaitAudioNormalization } from './audio-normalize.svelte';

/**
 * Gère le flux de segmentation "Native" en utilisant les données de timing
 * de Mp3Quran ou Quran.com.
 *
 * @param {number} [targetAssetId] ID de l'asset audio cible (optionnel).
 * @returns {Promise<AutoSegmentationResult | null>} Résultat ou null.
 */
export async function runNativeSegmentation(
	targetAssetId?: number
): Promise<AutoSegmentationResult | null> {
	const audioTrack = globalState.getAudioTrack;
	let targetClip: AssetClip | null = null;
	let nativeTimingMeta:
		| {
				provider: 'mp3quran';
				reciterId: number;
				surahId: number;
				moshafId?: number;
		  }
		| {
				provider: 'qdc';
				recitationId: number;
				surahId: number;
		  }
		| null = null;
	let clipStartTime = 0;
	let clipOffset = 0;

	const getClipOffset = (clip: AssetClip): number => {
		if ('offset' in clip && typeof clip.offset === 'number') {
			return clip.offset;
		}
		return 0;
	};

	// 1. Identifier le clip audio valide et ses métadonnées
	for (const clip of audioTrack.clips) {
		if (clip instanceof AssetClip) {
			if (typeof targetAssetId === 'number' && clip.assetId !== targetAssetId) {
				continue;
			}
			const asset = globalState.currentProject?.content.getAssetById(clip.assetId);
			if (asset?.metadata?.nativeTiming) {
				const meta = asset.metadata.nativeTiming as Partial<{
					provider: 'mp3quran' | 'qdc';
					reciterId: number;
					recitationId: number;
					surahId: number;
					moshafId?: number;
				}>;
				if (meta.provider === 'mp3quran') {
					if (typeof meta.reciterId !== 'number' || typeof meta.surahId !== 'number') continue;
					nativeTimingMeta = {
						provider: 'mp3quran',
						reciterId: meta.reciterId,
						surahId: meta.surahId,
						moshafId: meta.moshafId
					};
				} else if (meta.provider === 'qdc') {
					if (typeof meta.recitationId !== 'number' || typeof meta.surahId !== 'number') continue;
					nativeTimingMeta = {
						provider: 'qdc',
						recitationId: meta.recitationId,
						surahId: meta.surahId
					};
				} else {
					continue;
				}
				targetClip = clip;
				clipStartTime = clip.startTime;
				clipOffset = getClipOffset(clip);
				break;
			}
			if (asset?.metadata?.mp3Quran) {
				const meta = asset.metadata.mp3Quran as Partial<{
					reciterId: number;
					surahId: number;
					moshafId?: number;
				}>;
				if (typeof meta.reciterId !== 'number' || typeof meta.surahId !== 'number') continue;
				nativeTimingMeta = {
					provider: 'mp3quran',
					reciterId: meta.reciterId,
					surahId: meta.surahId,
					moshafId: meta.moshafId
				};
				targetClip = clip;
				clipStartTime = clip.startTime;
				clipOffset = getClipOffset(clip);
				break;
			}
		}
	}

	if (!targetClip || !nativeTimingMeta) {
		toast.error(get(LL).editor.noNativeTimingAudio());
		return { status: 'failed', message: 'No native-timing audio found' };
	}

	// 2. Alerte d'écrasement
	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite = await ModalManager.confirmModal(
			get(LL).editor.subtitlesAlreadyExistNative(),
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	// Re-timing audio en parallèle de la récupération du timing (point d'attente
	// avant la création des clips ci-dessous).
	beginAudioNormalizationIfNeeded();

	const surahId = nativeTimingMeta.surahId;
	let toastId: string | undefined;

	try {
		toastId = toast.loading(
			nativeTimingMeta.provider === 'qdc'
				? get(LL).editor.fetchingTimingQuranCom()
				: get(LL).editor.fetchingTimingMp3Quran()
		);

		// 3. Récupération des données de timing
		const timingData =
			nativeTimingMeta.provider === 'qdc'
				? ((
						await QdcRecitationService.getChapterAudio(nativeTimingMeta.recitationId, surahId, true)
					)?.timestamps?.map((timestamp) => ({
						ayah: Number(timestamp.verse_key.split(':')[1]),
						start_time: timestamp.timestamp_from,
						end_time: timestamp.timestamp_to
					})) ?? [])
				: await Mp3QuranService.getSurahTiming(
						nativeTimingMeta.moshafId ?? nativeTimingMeta.reciterId,
						surahId
					);

		if (!timingData || timingData.length === 0) {
			toast.error(get(LL).editor.noTimingDataFound(), { id: toastId });
			return { status: 'failed', message: 'No timing data returned from API.' };
		}

		// 4. Chargement des données du Quran
		await Quran.load();

		// Garde : attendre la fin du re-timing audio avant de poser les clips.
		await awaitAudioNormalization();

		// 5. Construction des clips
		subtitleTrack.clips = [];
		let segmentsApplied = 0;

		for (const verseTiming of timingData) {
			const timingStart = verseTiming.start_time;
			const timingEnd = verseTiming.end_time;

			if (timingEnd < clipOffset) continue;

			const relativeStart = timingStart - clipOffset;
			const relativeEnd = timingEnd - clipOffset;

			const absStart = clipStartTime + relativeStart;
			const absEnd = clipStartTime + relativeEnd;

			const verse = await Quran.getVerse(surahId, verseTiming.ayah);
			if (!verse) continue;

			const startIndex = 0;
			const endIndex = verse.words.length - 1;

			const arabicText = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
			const indopakText = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex, 'indopak');
			const wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(startIndex, endIndex);

			const subtitlesProperties = await subtitleTrack.getSubtitlesProperties(
				verse,
				startIndex,
				endIndex,
				surahId
			);

			const clip = new SubtitleClip(
				Math.max(0, absStart),
				Math.max(0, absEnd),
				surahId,
				verseTiming.ayah,
				startIndex,
				endIndex,
				arabicText,
				wbwTranslation,
				subtitlesProperties.isFullVerse,
				subtitlesProperties.isLastWordsOfVerse,
				subtitlesProperties.translations,
				indopakText,
				true,
				1.0 // Confiance 100%, timing manuel/officiel
			);

			subtitleTrack.clips.push(clip);
			segmentsApplied++;
		}

		// 6. Post-processing
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);
		closeSmallSubtitleGaps(subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip>);
		subtitleTrack.clips = insertSilenceClips(
			subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>
		);

		// 7. Gestion du silence final
		const audioDuration = audioTrack.getDuration().ms;
		const lastClip = subtitleTrack.clips[subtitleTrack.clips.length - 1];
		if (lastClip && lastClip.endTime < audioDuration - 200) {
			const silenceStart = lastClip.endTime + 1;
			const silenceEnd = audioDuration;
			if (silenceEnd > silenceStart) {
				subtitleTrack.clips.push(new SilenceClip(silenceStart, silenceEnd));
			}
		}

		// 8. Remplacer le premier silence par une basmala si pertinent
		const firstClip = subtitleTrack.clips[0];
		const secondClip = subtitleTrack.clips[1];
		if (firstClip && firstClip instanceof SilenceClip && secondClip instanceof SubtitleClip) {
			const basmalaClip = new PredefinedSubtitleClip(
				firstClip.startTime,
				firstClip.endTime,
				secondClip.surah !== 9 ? 'Basmala' : "Isti'adha"
			);
			subtitleTrack.clips[0] = basmalaClip;
		}

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		globalState.getSubtitlesEditorState.initialLowConfidenceCount = 0;

		toast.success(get(LL).editor.appliedSubtitlesFromMp3Quran({ count: segmentsApplied }), { id: toastId });

		return {
			status: 'completed',
			segmentsApplied,
			lowConfidenceSegments: 0,
			coverageGapSegments: 0,
			verseRange: new VerseRange()
		};
	} catch (error) {
		console.error('Native segmentation error:', error);
		toast.error(get(LL).editor.errorTiming({ error: String(error) }), { id: toastId });
		return { status: 'failed', message: String(error) };
	}
}
