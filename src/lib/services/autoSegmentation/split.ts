import { Quran } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';
import { SubtitleClip } from '$lib/classes';
import { SUBDIVIDE_MAX_WORDS_DISABLED, SUBDIVIDE_MAX_DURATION_DISABLED } from './types';
import { refreshSegmentationContextFromTrack } from './context';
import { getSubtitleClipWordCount } from './review';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

/**
 * Applique silencieusement une nouvelle plage de mots à un clip Quran existant.
 *
 * @param {SubtitleClip} clip Clip à mettre à jour.
 * @param {Awaited<ReturnType<typeof Quran.getVerse>>} verse Verset source.
 * @param {number} startWordIndex Index du premier mot.
 * @param {number} endWordIndex Index du dernier mot.
 */
export async function hydrateSubtitleClipRange(
	clip: SubtitleClip,
	verse: Awaited<ReturnType<typeof Quran.getVerse>>,
	startWordIndex: number,
	endWordIndex: number
): Promise<void> {
	if (!verse) return;

	clip.startWordIndex = startWordIndex;
	clip.endWordIndex = endWordIndex;
	clip.text = verse.getArabicTextBetweenTwoIndexes(startWordIndex, endWordIndex);
	clip.indopakText = verse.getArabicTextBetweenTwoIndexes(startWordIndex, endWordIndex, 'indopak');
	clip.wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(
		startWordIndex,
		endWordIndex
	);
	const subtitlesProperties = await globalState.getSubtitleTrack.getSubtitlesProperties(
		verse,
		startWordIndex,
		endWordIndex,
		clip.surah
	);
	clip.isFullVerse = subtitlesProperties.isFullVerse;
	clip.isLastWordsOfVerse = subtitlesProperties.isLastWordsOfVerse;
	clip.translations = subtitlesProperties.translations;
	clip.clearArabicInlineStyles();
}

/**
 * Découpe localement les métadonnées d'alignement d'un clip Quran autour d'un mot.
 *
 * @param {SubtitleClip} clip Clip source.
 * @param {number} splitWordIndex Index du dernier mot de la partie gauche.
 * @returns {Promise<SubtitleClip | null>} Nouveau clip droit créé, ou null si impossible.
 */
export async function splitSubtitleClipLocally(
	clip: SubtitleClip,
	splitWordIndex: number
): Promise<SubtitleClip | null> {
	const metadata = clip.alignmentMetadata;
	if (!metadata) return null;
	if (splitWordIndex < clip.startWordIndex || splitWordIndex >= clip.endWordIndex) return null;

	const splitLocation = `${clip.surah}:${clip.verse}:${splitWordIndex + 1}`;
	const splitWord = metadata.words.find((word) => word.location === splitLocation);
	if (!splitWord) return null;

	const splitAbsoluteMs = Math.round((metadata.timeFrom + splitWord.end) * 1000);
	if (splitAbsoluteMs - clip.startTime < 100 || clip.endTime - splitAbsoluteMs < 100) {
		return null;
	}

	const verse = await Quran.getVerse(clip.surah, clip.verse);
	if (!verse) return null;

	const originalEndTime = clip.endTime;
	const originalStartWordIndex = clip.startWordIndex;
	const originalEndWordIndex = clip.endWordIndex;
	const originalMetadata = metadata;
	const originalNeedsReview = clip.needsReview;
	const originalNeedsCoverageReview = clip.needsCoverageReview;
	const originalNeedsLongReview = clip.needsLongReview;
	const originalHasBeenVerified = clip.hasBeenVerified;
	const originalComeFromIA = clip.comeFromIA;
	const originalConfidence = clip.confidence;

	clip.setEndTimeSilently(splitAbsoluteMs);
	await hydrateSubtitleClipRange(clip, verse, originalStartWordIndex, splitWordIndex);

	const rightClip = clip.cloneWithTimes(splitAbsoluteMs, originalEndTime);
	rightClip.comeFromIA = originalComeFromIA;
	rightClip.confidence = originalConfidence;
	rightClip.needsReview = originalNeedsReview;
	rightClip.needsCoverageReview = originalNeedsCoverageReview;
	rightClip.needsLongReview = originalNeedsLongReview;
	rightClip.hasBeenVerified = originalHasBeenVerified;
	await hydrateSubtitleClipRange(rightClip, verse, splitWordIndex + 1, originalEndWordIndex);

	const splitOffsetS = splitWord.end;
	const leftWords = originalMetadata.words
		.filter((word) => {
			const wordIndex = Number(word.location.split(':')[2]);
			return Number.isFinite(wordIndex) && wordIndex <= splitWordIndex + 1;
		})
		.map((word) => ({ ...word }));
	const rightWords = originalMetadata.words
		.filter((word) => {
			const wordIndex = Number(word.location.split(':')[2]);
			return Number.isFinite(wordIndex) && wordIndex > splitWordIndex + 1;
		})
		.map((word) => ({
			...word,
			start: Math.max(0, word.start - splitOffsetS),
			end: Math.max(0, word.end - splitOffsetS)
		}));

	clip.alignmentMetadata = {
		...originalMetadata,
		refFrom: `${clip.surah}:${clip.verse}:${originalStartWordIndex + 1}`,
		refTo: `${clip.surah}:${clip.verse}:${splitWordIndex + 1}`,
		matchedText: verse.getArabicTextBetweenTwoIndexes(originalStartWordIndex, splitWordIndex),
		timeTo: splitAbsoluteMs / 1000,
		words: leftWords
	};
	rightClip.alignmentMetadata = {
		...originalMetadata,
		refFrom: `${rightClip.surah}:${rightClip.verse}:${rightClip.startWordIndex + 1}`,
		refTo: `${rightClip.surah}:${rightClip.verse}:${rightClip.endWordIndex + 1}`,
		matchedText: verse.getArabicTextBetweenTwoIndexes(
			rightClip.startWordIndex,
			rightClip.endWordIndex
		),
		timeFrom: splitAbsoluteMs / 1000,
		words: rightWords
	};

	const clipIndex = globalState.getSubtitleTrack.clips.findIndex(
		(candidate) => candidate.id === clip.id
	);
	if (clipIndex === -1) return null;
	globalState.getSubtitleTrack.clips.splice(clipIndex + 1, 0, rightClip);
	return rightClip;
}

/**
 * Extrait l'index de mot Quran (0-based) à partir d'une location MFA.
 *
 * @param {string} location Clé de mot au format `surah:verse:word`.
 * @returns {number | null} Index 0-based, ou null si invalide.
 */
function _getWordIndexFromLocation(location: string): number | null {
	const wordIndex = Number(location.split(':')[2]);
	if (!Number.isFinite(wordIndex) || wordIndex <= 0) return null;
	return wordIndex - 1;
}

/**
 * Cherche le meilleur point de coupe sur un waqf proche d'une cible.
 *
 * @param {SubtitleClip} clip Clip Quran à inspecter.
 * @param {Awaited<ReturnType<typeof Quran.getVerse>>} verse Verset source.
 * @param {number} targetIndex Index cible autour duquel couper.
 * @returns {number | null} Index du dernier mot de la partie gauche.
 */
function findPreferredStopSplitIndex(
	clip: SubtitleClip,
	verse: Awaited<ReturnType<typeof Quran.getVerse>>,
	targetIndex: number
): number | null {
	if (!verse) return null;

	const waqfPriority = ['ۗ', 'ۚ', 'ۖ'];
	for (const waqf of waqfPriority) {
		const candidates: number[] = [];
		for (let index = clip.startWordIndex; index < clip.endWordIndex; index += 1) {
			if (verse.words[index]?.arabic.includes(waqf)) {
				candidates.push(index);
			}
		}

		if (candidates.length > 0) {
			return [...candidates].sort(
				(left, right) => Math.abs(left - targetIndex) - Math.abs(right - targetIndex)
			)[0];
		}
	}

	return null;
}

/**
 * Calcule le meilleur mot de coupe pour la subdivision locale d'un clip.
 *
 * @param {SubtitleClip} clip Clip Quran à subdiviser.
 * @param {number | null} maxWords Limite de mots active, ou null.
 * @param {number | null} maxDurationSeconds Limite de durée active, ou null.
 * @param {boolean} onlyStopSigns Si true, interdit le fallback hors waqf.
 * @returns {Promise<number | null>} Index du dernier mot de gauche, ou null.
 */
async function getAutomaticSplitWordIndex(
	clip: SubtitleClip,
	maxWords: number | null,
	maxDurationSeconds: number | null,
	onlyStopSigns: boolean
): Promise<number | null> {
	const wordCount = getSubtitleClipWordCount(clip);
	const exceedsWords = maxWords !== null && wordCount > maxWords;
	const exceedsDuration = maxDurationSeconds !== null && clip.duration / 1000 > maxDurationSeconds;
	if (!exceedsWords && !exceedsDuration) return null;
	if (!clip.alignmentMetadata || wordCount < 2) return null;

	const verse = await Quran.getVerse(clip.surah, clip.verse);
	if (!verse) return null;

	let targetIndex = clip.startWordIndex;
	if (exceedsWords && maxWords !== null) {
		targetIndex = Math.min(clip.startWordIndex + maxWords - 1, clip.endWordIndex - 1);
	} else {
		targetIndex = Math.min(
			clip.startWordIndex + Math.max(1, Math.floor(wordCount / 2)) - 1,
			clip.endWordIndex - 1
		);
	}

	const waqfIndex = findPreferredStopSplitIndex(clip, verse, targetIndex);
	if (waqfIndex !== null) return waqfIndex;
	return onlyStopSigns ? null : targetIndex;
}

/**
 * Coupe automatiquement un sous-titre Quran au mot fourni.
 *
 * @param {SubtitleClip} clip Clip Quran actuellement édité.
 * @param {number} splitWordIndex Index du dernier mot de la partie gauche.
 * @returns {Promise<boolean>} True si la coupe a été appliquée.
 */
export async function automaticSplitSubtitleAtWord(
	clip: SubtitleClip,
	splitWordIndex: number
): Promise<boolean> {
	ProjectHistoryManager.begin('automatic split subtitle');
	try {
		const metadata = clip.alignmentMetadata;
		if (!metadata) {
			console.warn('[AutoSegmentation] Automatic split aborted: missing alignment metadata.', {
				clipId: clip.id,
				surah: clip.surah,
				verse: clip.verse,
				splitWordIndex
			});
			return false;
		}

		if (metadata.words.length === 0) {
			console.warn(
				'[AutoSegmentation] Automatic split aborted: no MFA word timestamps are available for this clip.',
				{
					clipId: clip.id,
					surah: clip.surah,
					verse: clip.verse,
					splitWordIndex,
					segment: metadata.segment
				}
			);
			return false;
		}

		const splitLocation = `${clip.surah}:${clip.verse}:${splitWordIndex + 1}`;
		const splitWord = metadata.words.find((word) => word.location === splitLocation);
		if (!splitWord) {
			console.warn(
				'[AutoSegmentation] Automatic split aborted: selected word timestamp was not found in alignment metadata.',
				{
					clipId: clip.id,
					splitWordIndex,
					splitLocation,
					availableLocations: metadata.words.map((word) => word.location)
				}
			);
			return false;
		}

		const splitTimeMs = Math.round((metadata.timeFrom + splitWord.end) * 1000);
		if (splitTimeMs - clip.startTime < 100 || clip.endTime - splitTimeMs < 100) {
			console.warn(
				'[AutoSegmentation] Automatic split aborted: computed split point would create a segment shorter than 100ms.',
				{
					clipId: clip.id,
					splitWordIndex,
					splitTimeMs,
					clipStartTime: clip.startTime,
					clipEndTime: clip.endTime
				}
			);
			return false;
		}

		const rightClip = await splitSubtitleClipLocally(clip, splitWordIndex);
		if (!rightClip) {
			console.warn('[AutoSegmentation] Local split failed.', {
				clipId: clip.id,
				splitWordIndex,
				splitLocation
			});
			return false;
		}

		refreshSegmentationContextFromTrack(false);
		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		globalState.getSubtitlesEditorState.editSubtitle = rightClip;
		return true;
	} finally {
		ProjectHistoryManager.commit();
	}
}

/**
 * Subdivise localement tous les sous-titres Quran dépassant les critères actifs.
 *
 * @returns {Promise<number>} Nombre de coupes appliquées.
 */
export async function subdivideLongSubtitleSegments(): Promise<number> {
	ProjectHistoryManager.begin('subdivide subtitles');
	try {
		const state = globalState.getSubtitlesEditorState;
		const maxWords =
			state.subdivideMaxWordsPerSegment > SUBDIVIDE_MAX_WORDS_DISABLED
				? null
				: state.subdivideMaxWordsPerSegment;
		const maxDurationSeconds =
			state.subdivideMaxDurationPerSegment > SUBDIVIDE_MAX_DURATION_DISABLED
				? null
				: state.subdivideMaxDurationPerSegment;

		let splitCount = 0;
		let madeProgress = true;
		while (madeProgress) {
			madeProgress = false;
			const clips = [...globalState.getSubtitleClips].sort(
				(left, right) => left.startTime - right.startTime
			);
			for (const clip of clips) {
				const splitWordIndex = await getAutomaticSplitWordIndex(
					clip,
					maxWords,
					maxDurationSeconds,
					state.subdivideOnlySplitAtStopSigns
				);
				if (splitWordIndex === null) continue;

				const rightClip = await splitSubtitleClipLocally(clip, splitWordIndex);
				if (!rightClip) continue;

				splitCount += 1;
				madeProgress = true;
				break;
			}
		}

		if (splitCount > 0) {
			refreshSegmentationContextFromTrack(false);
			globalState.currentProject?.detail.updateVideoDetailAttributes();
			globalState.updateVideoPreviewUI();
		}

		return splitCount;
	} finally {
		ProjectHistoryManager.commit();
	}
}
