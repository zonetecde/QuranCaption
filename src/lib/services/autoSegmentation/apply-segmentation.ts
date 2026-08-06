import toast from 'svelte-5-french-toast';
import { Quran } from '$lib/classes/Quran';
import { PredefinedSubtitleClip, SilenceClip, SubtitleClip, type Translation } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { VerseRange } from '$lib/classes/VerseRange.svelte';
import type {
	ApplySegmentationResponseParams,
	AutoSegmentationResult,
	PredefinedType,
	SegmentationClipTemplate,
	SegmentationSegment,
	SegmentationWordTimestamp,
	StoredAlignedSegment,
	VerseRef
} from './types';
import { detectCoverageGapIndices, parseVerseRef } from './verse-ref';
import { getPredefinedType } from './predefined';
import {
	buildStoredAlignedSegment,
	buildSubtitleAlignmentMetadata,
	filterWordsForVerse,
	getSegmentWords,
	splitWordsAtReferenceReset
} from './context';
import {
	closeSmallSubtitleGaps,
	extendSubtitlesBeforeSilence,
	extendSubtitlesToFillGaps,
	insertSilenceClips
} from './timeline';
import { awaitAudioNormalization } from './audio-normalize.svelte';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';
import type { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { alignExistingSubtitles } from './align-existing';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

/**
 * Rend la main au moteur de rendu toutes les {@link UI_YIELD_INTERVAL} itérations.
 *
 * Sur une longue sourate (Al-Baqara ≈ 286 versets → un millier de clips), la
 * construction puis la matérialisation des clips tournent en une seule tâche
 * synchrone : le navigateur ne peut jamais repeindre et l'app paraît figée.
 * Un `setTimeout(0)` périodique laisse l'UI respirer sans changer la logique.
 */
const UI_YIELD_INTERVAL = 25;
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Marque les traductions d'un clip comme "to review".
 *
 * @param {SubtitleClip} clip Clip dont les traductions doivent être marquées.
 */
function markClipTranslationsForReview(clip: SubtitleClip, project: Project): void {
	const addedEditions = project.content.projectTranslation.addedTranslationEditions;
	if (!addedEditions) return;

	for (const edition of addedEditions) {
		const translation = clip.translations[edition.name];
		if (translation && typeof translation.updateStatus === 'function') {
			translation.updateStatus('to review', edition);
		}
	}
}

/**
 * Construit et ajoute un template de sous-titre Quran au plan de matérialisation.
 *
 * @param {Object} clipParams Paramètres du clip.
 * @param {SegmentationClipTemplate[]} clipTemplates Tableau de templates à remplir.
 */
async function pushSubtitleTemplate(
	clipParams: {
		segment: SegmentationSegment;
		startMs: number;
		endMs: number;
		surah: number;
		verseNumber: number;
		startIndex: number;
		endIndex: number;
		verse: Awaited<ReturnType<typeof Quran.getVerse>>;
		confidence: number | null;
		isLowConfidence: boolean;
		needsReview: boolean;
		needsCoverageReview: boolean;
	},
	clipTemplates: SegmentationClipTemplate[]
): Promise<void> {
	const {
		segment,
		startMs,
		endMs,
		surah,
		verseNumber,
		startIndex,
		endIndex,
		verse,
		confidence,
		isLowConfidence,
		needsReview,
		needsCoverageReview
	} = clipParams;

	if (!verse) return;
	const segmentWords = filterWordsForVerse(getSegmentWords(segment), surah, verseNumber);
	const wordGroups = splitWordsAtReferenceReset(segmentWords);
	if (wordGroups.length > 1) {
		const segmentStartMs = (segment.time_from ?? startMs / 1000) * 1000;
		for (const words of wordGroups) {
			const firstRef = parseVerseRef(words[0].location);
			const lastRef = parseVerseRef(words[words.length - 1].location);
			if (!firstRef || !lastRef) continue;

			const groupStartIndex = Math.max(startIndex, firstRef.word - 1);
			const groupEndIndex = Math.min(endIndex, lastRef.word - 1);
			if (groupStartIndex > groupEndIndex) continue;

			clipTemplates.push({
				kind: 'subtitle',
				segment,
				originalStartMs: Math.max(startMs, Math.round(segmentStartMs + words[0].start * 1000)),
				originalEndMs: Math.min(
					endMs,
					Math.round(segmentStartMs + words[words.length - 1].end * 1000)
				),
				surah,
				verseNumber,
				startIndex: groupStartIndex,
				endIndex: groupEndIndex,
				verse,
				confidence,
				isLowConfidence,
				needsReview,
				needsCoverageReview,
				segmentWords: words
			});
		}
		return;
	}

	clipTemplates.push({
		kind: 'subtitle',
		segment,
		originalStartMs: startMs,
		originalEndMs: endMs,
		surah,
		verseNumber,
		startIndex,
		endIndex,
		verse,
		confidence,
		isLowConfidence,
		needsReview,
		needsCoverageReview,
		segmentWords
	});
}

/**
 * Crée un SubtitleClip ou PredefinedSubtitleClip à partir d'un template
 * et l'ajoute à la timeline.
 *
 * @param {SegmentationClipTemplate} template Template à matérialiser.
 * @param {number} startMs Début effectif du clip.
 * @param {number} endMs Fin effective du clip.
 * @param {number} alignmentStartMs Début pour les métadonnées d'alignement.
 * @param {number} alignmentEndMs Fin pour les métadonnées d'alignement.
 * @param {string} segmentationSource Source de la segmentation.
 * @param {SegmentationSegment} segment Segment source original.
 * @param {number} segmentsApplied Compteur de segments appliqués (muté).
 * @param {number} lowConfidenceSegments Compteur low confidence (muté).
 * @param {number} coverageGapSegments Compteur coverage gap (muté).
 * @param {number} reviewSegments Compteur review (muté).
 * @param {StoredAlignedSegment[]} storedAlignedSegments Tableau de segments alignés (muté).
 */
async function materializeTemplate(
	project: Project,
	subtitleTrack: SubtitleTrack,
	template: SegmentationClipTemplate,
	startMs: number,
	endMs: number,
	alignmentStartMs: number,
	alignmentEndMs: number,
	segmentationSource: 'api' | 'local' | 'import',
	segmentsApplied: { value: number },
	lowConfidenceSegments: { value: number },
	coverageGapSegments: { value: number },
	reviewSegments: { value: number },
	storedAlignedSegments: StoredAlignedSegment[],
	// Tableau plat de destination (PAS `subtitleTrack.clips` réactif) : on pousse
	// dans un array simple puis on l'assigne une seule fois côté appelant. Pousser
	// 1300+ clips dans le $state proxy déclenche autant de re-renders timeline →
	// c'était 95% du temps d'application.
	targetClips: Array<SubtitleClip | PredefinedSubtitleClip>
): Promise<void> {
	const alignmentSegment: SegmentationSegment = {
		...template.segment,
		time_from: alignmentStartMs / 1000,
		time_to: alignmentEndMs / 1000
	};

	if (template.kind === 'predefined') {
		const clip = new PredefinedSubtitleClip(
			startMs,
			endMs,
			template.predefinedType,
			undefined,
			true,
			template.confidence,
			project.content.projectTranslation
		);
		targetClips.push(clip);
		const storedAlignedSegment = buildStoredAlignedSegment(
			clip.id,
			'Pre-defined Subtitle',
			startMs,
			endMs,
			alignmentSegment,
			template.segmentWords
		);
		if (storedAlignedSegment) {
			storedAlignedSegments.push(storedAlignedSegment);
		}
		segmentsApplied.value += 1;
		if (template.isLowConfidence) lowConfidenceSegments.value += 1;
		if (clip.needsReview) reviewSegments.value += 1;
		return;
	}

	// Subtitle Quran
	const arabicText: string = template.verse.getArabicTextBetweenTwoIndexes(
		template.startIndex,
		template.endIndex
	);
	const indopakText: string = template.verse.getArabicTextBetweenTwoIndexes(
		template.startIndex,
		template.endIndex,
		'indopak'
	);
	const wbwTranslation: string[] = template.verse.getWordByWordTranslationBetweenTwoIndexes(
		template.startIndex,
		template.endIndex
	);

	const subtitlesProperties: {
		isFullVerse: boolean;
		isLastWordsOfVerse: boolean;
		translations: { [key: string]: Translation };
	} = await subtitleTrack.getSubtitlesProperties(
		template.verse,
		template.startIndex,
		template.endIndex,
		template.surah,
		project.content.projectTranslation
	);

	const clip: SubtitleClip = new SubtitleClip(
		startMs,
		endMs,
		template.surah,
		template.verseNumber,
		template.startIndex,
		template.endIndex,
		arabicText,
		wbwTranslation,
		subtitlesProperties.isFullVerse,
		subtitlesProperties.isLastWordsOfVerse,
		subtitlesProperties.translations,
		indopakText,
		true,
		template.confidence
	);
	const clipDurationS = (endMs - startMs) / 1000;
	const sourceStartS = template.segment.time_from ?? alignmentStartMs / 1000;
	// Les mots MFA restent relatifs au segment source, même après découpage par verset.
	const wordOffsetS = alignmentStartMs / 1000 - sourceStartS;
	const clampedWords =
		template.segmentWords.length > 0
			? template.segmentWords.map((word, index, arr) => {
					const localStart = word.start - wordOffsetS;
					const localEnd = word.end - wordOffsetS;
					return {
						...word,
						start: index === 0 ? 0 : Math.max(0, Math.min(clipDurationS, localStart)),
						end:
							index === arr.length - 1
								? clipDurationS
								: Math.max(0, Math.min(clipDurationS, localEnd))
					};
				})
			: template.segmentWords;
	clip.alignmentMetadata = buildSubtitleAlignmentMetadata(
		segmentationSource,
		alignmentSegment,
		clampedWords
	);

	if (template.needsReview || template.needsCoverageReview) {
		clip.needsReview = true;
		if (template.needsCoverageReview) clip.needsCoverageReview = true;
		markClipTranslationsForReview(clip, project);
	}

	targetClips.push(clip);
	const storedAlignedSegment = buildStoredAlignedSegment(
		clip.id,
		'Subtitle',
		startMs,
		endMs,
		alignmentSegment,
		template.segmentWords
	);
	if (storedAlignedSegment) {
		storedAlignedSegments.push(storedAlignedSegment);
	}
	segmentsApplied.value += 1;
	if (template.isLowConfidence) lowConfidenceSegments.value += 1;
	if (template.needsCoverageReview) coverageGapSegments.value += 1;
	if (clip.needsReview) reviewSegments.value += 1;
}

/**
 * Traite un segment cross-verse en le découpant en plusieurs clips
 * (un par verset), en utilisant ou non les timestamps WBW.
 *
 * @param {Object} params Paramètres du segment à traiter.
 * @param {SegmentationClipTemplate[]} clipTemplates Tableau de templates à remplir.
 * @returns {Promise<void>}
 */
async function processCrossVerseSegment(
	params: {
		segment: SegmentationSegment;
		startMs: number;
		endMs: number;
		startRef: VerseRef;
		endRef: VerseRef;
		confidence: number | null;
		isLowConfidence: boolean;
		needsCoverageReview: boolean;
		segmentationSource: 'api' | 'local' | 'import';
		includeWbwTimestamps: boolean;
		modelName?: string | null;
	},
	clipTemplates: SegmentationClipTemplate[]
): Promise<void> {
	const {
		segment,
		startMs,
		endMs,
		startRef,
		endRef,
		confidence,
		isLowConfidence,
		needsCoverageReview,
		segmentationSource,
		includeWbwTimestamps,
		modelName
	} = params;

	const isLocalMultiAligner =
		segmentationSource === 'local' && (modelName === 'Base' || modelName === 'Large');
	const forceLowConfidenceFallback = isLocalMultiAligner && !includeWbwTimestamps;
	const segmentWords = getSegmentWords(segment);
	const useWbwBoundaries = includeWbwTimestamps && segmentWords.length > 0;
	const segmentStartMsRaw = (segment.time_from ?? 0) * 1000;

	const splitDefinitions: Array<{
		startMs: number;
		endMs: number;
		surah: number;
		verseNumber: number;
		startIndex: number;
		endIndex: number;
		wordCount: number;
		needsReview: boolean;
	}> = [];
	let splitNeedsReview = false;
	let missingWbwBoundaries = false;

	for (let verseNumber = startRef.verse; verseNumber <= endRef.verse; verseNumber += 1) {
		const verse = await Quran.getVerse(startRef.surah, verseNumber);
		if (!verse) {
			console.warn('Verse not found for cross-verse segment:', { segment, verseNumber });
			continue;
		}

		const verseWordCount = verse.words.length;
		if (verseWordCount === 0) {
			console.error('Verse has no word data in cross-verse segment', { segment, verseNumber });
			continue;
		}

		const clampIndex = (value: number) => Math.min(Math.max(value, 0), verseWordCount - 1);
		let startIndex = 0;
		let endIndex = verseWordCount - 1;
		let needsReview = false;

		if (verseNumber === startRef.verse) {
			const rawStartIndex = startRef.word - 1;
			startIndex = clampIndex(rawStartIndex);
			if (rawStartIndex < 0 || rawStartIndex >= verseWordCount) needsReview = true;
		}

		if (verseNumber === endRef.verse) {
			const rawEndIndex = endRef.word - 1;
			endIndex = clampIndex(rawEndIndex);
			if (rawEndIndex < 0 || rawEndIndex >= verseWordCount) needsReview = true;
		}

		if (startIndex > endIndex) {
			needsReview = true;
			[startIndex, endIndex] = [endIndex, startIndex];
		}

		splitNeedsReview = splitNeedsReview || needsReview;
		splitDefinitions.push({
			startMs,
			endMs,
			surah: startRef.surah,
			verseNumber,
			startIndex,
			endIndex,
			wordCount: endIndex - startIndex + 1,
			needsReview
		});
	}

	const totalWords = splitDefinitions.reduce((sum, def) => sum + def.wordCount, 0);
	if (splitDefinitions.length === 0 || totalWords === 0) return;

	if (useWbwBoundaries) {
		for (const def of splitDefinitions) {
			const verseWords = segmentWords
				.map((word) => ({ word, ref: parseVerseRef(word.location) }))
				.filter(
					(entry): entry is { word: SegmentationWordTimestamp; ref: VerseRef } =>
						entry.ref !== null &&
						entry.ref.surah === def.surah &&
						entry.ref.verse === def.verseNumber
				)
				.sort((left, right) => left.ref.word - right.ref.word);
			const targetStartWord = def.startIndex + 1;
			const targetEndWord = def.endIndex + 1;
			const startWord =
				verseWords.find((entry) => entry.ref.word === targetStartWord) ??
				verseWords.find((entry) => entry.ref.word >= targetStartWord);
			const endWord =
				[...verseWords].reverse().find((entry) => entry.ref.word === targetEndWord) ??
				[...verseWords].reverse().find((entry) => entry.ref.word <= targetEndWord);

			if (!startWord || !endWord) {
				missingWbwBoundaries = true;
				splitNeedsReview = true;
				break;
			}

			const computedStartMs = Math.round(segmentStartMsRaw + startWord.word.start * 1000);
			const computedEndMs = Math.round(segmentStartMsRaw + endWord.word.end * 1000);
			def.startMs = Math.max(startMs, computedStartMs);
			def.endMs = Math.max(def.startMs, Math.min(endMs, computedEndMs));
		}
	}

	if (!useWbwBoundaries || missingWbwBoundaries) {
		const totalSpan = endMs - startMs + 1;
		let currentStart = startMs;

		for (let i = 0; i < splitDefinitions.length; i += 1) {
			const def = splitDefinitions[i];
			const remainingParts = splitDefinitions.length - i;
			const remainingSpan = endMs - currentStart + 1;
			const minRemaining = remainingParts - 1;
			let length = remainingSpan;

			if (i < splitDefinitions.length - 1) {
				const rawLength = Math.round((def.wordCount / totalWords) * totalSpan);
				const maxLength = Math.max(1, remainingSpan - minRemaining);
				length = Math.min(Math.max(1, rawLength), maxLength);
			}

			def.startMs = currentStart;
			def.endMs = currentStart + length - 1;
			currentStart = def.endMs + 1;
		}
	}

	for (const def of splitDefinitions) {
		const verse = await Quran.getVerse(def.surah, def.verseNumber);
		if (!verse) continue;
		const clipConfidence = forceLowConfidenceFallback
			? Math.min(confidence ?? 0.5, 0.5)
			: confidence;
		const clipIsLowConfidence = forceLowConfidenceFallback ? true : isLowConfidence;
		await pushSubtitleTemplate(
			{
				segment,
				startMs: def.startMs,
				endMs: def.endMs,
				surah: def.surah,
				verseNumber: def.verseNumber,
				startIndex: def.startIndex,
				endIndex: def.endIndex,
				verse,
				confidence: clipConfidence,
				isLowConfidence: clipIsLowConfidence,
				needsReview: splitNeedsReview || def.needsReview,
				needsCoverageReview
			},
			clipTemplates
		);
	}
}

/**
 * Applique une réponse de segmentation au projet : transforme les segments
 * en clips (SubtitleClip, PredefinedSubtitleClip, SilenceClip) sur la timeline.
 *
 * @param {ApplySegmentationResponseParams} params Paramètres de la réponse.
 * @returns {Promise<AutoSegmentationResult>} Résultat de l'opération.
 */
export async function applySegmentationResponseToProject(
	params: ApplySegmentationResponseParams
): Promise<AutoSegmentationResult> {
	const project = params.project ?? globalState.currentProject;
	if (!project) return { status: 'failed', message: 'No project is currently open.' };
	const headless = params.headless ?? false;
	const {
		response,
		fillBySilence,
		extendBeforeSilence,
		extendBeforeSilenceMs,
		fallbackToCloud,
		cloudGpuFallbackToCpu,
		requestedMode,
		effectiveMode,
		segmentationSource,
		includeWbwTimestamps,
		modelName,
		device,
		warningOverride,
		payloadForLog
	} = params;

	if (response.warning && !headless) {
		toast(response.warning);
	}
	if (response.error) {
		return { status: 'failed', message: response.error };
	}

	const segments: SegmentationSegment[] = response?.segments ?? [];
	if (segments.length === 0) {
		const message = response.error || 'No segments returned from the segmentation service.';
		return { status: 'failed', message };
	}

	// Garde : s'assurer que le re-timing audio (lancé en parallèle) est terminé
	// avant de matérialiser les clips, pour que les timestamps coïncident avec
	// l'audio rejoué.
	if (params.audioNormalizationPromise) await params.audioNormalizationPromise;
	else await awaitAudioNormalization();

	const subtitleTrack = project.content.timeline.getFirstTrack(TrackType.Subtitle) as SubtitleTrack;
	if (params.subtitleApplicationMode === 'align') {
		return ProjectHistoryManager.track('align existing subtitles', () => {
			const alignedResult = alignExistingSubtitles({
				subtitleTrack,
				segments: [...segments].sort(
					(left, right) => (left.time_from ?? 0) - (right.time_from ?? 0)
				),
				segmentationSource,
				projectTranslation: project.content.projectTranslation,
				fillBySilence,
				extendBeforeSilence,
				extendBeforeSilenceMs
			});
			const clipsById = new Map(subtitleTrack.clips.map((clip) => [clip.id, clip]));
			for (const storedAlignedSegment of alignedResult.storedAlignedSegments) {
				const clip = clipsById.get(storedAlignedSegment.clipId);
				if (!clip) continue;
				storedAlignedSegment.startMs = clip.startTime;
				storedAlignedSegment.endMs = clip.endTime;
			}
			const verseRange = VerseRange.getVerseRangeFromClips(
				subtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip),
				0,
				subtitleTrack.getDuration().ms
			);
			const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio) as AssetTrack;
			project.detail.updateVideoDetailAttributesForTracks(audioTrack, subtitleTrack);
			if (!headless) globalState.updateVideoPreviewUI();
			project.projectEditorState.subtitlesEditor.initialLowConfidenceCount =
				alignedResult.lowConfidenceSegments;
			project.projectEditorState.subtitlesEditor.segmentationContext = {
				audioId: response.audio_id ?? null,
				source: segmentationSource,
				effectiveMode,
				modelName: modelName ?? null,
				device: device ?? null,
				includeWbwTimestamps: true,
				alignedSegments: alignedResult.storedAlignedSegments
			};

			return {
				status: 'completed',
				segmentsApplied: alignedResult.segmentsApplied,
				lowConfidenceSegments: alignedResult.lowConfidenceSegments,
				coverageGapSegments: subtitleTrack.clips.filter(
					(clip) => clip instanceof SubtitleClip && clip.needsCoverageReview
				).length,
				verseRange,
				fallbackToCloud,
				cloudGpuFallbackToCpu,
				warning: response.warning ?? warningOverride,
				requestedMode,
				effectiveMode
			};
		});
	}
	subtitleTrack.clips = [];
	await Quran.load();

	const segmentsApplied = { value: 0 };
	const lowConfidenceSegments = { value: 0 };
	let coverageGapSegmentsNum = 0;
	const reviewSegments = { value: 0 };
	const storedAlignedSegments: StoredAlignedSegment[] = [];
	const clipTemplates: SegmentationClipTemplate[] = [];

	const orderedSegments: SegmentationSegment[] = [...segments].sort(
		(a, b) => (a.time_from ?? 0) - (b.time_from ?? 0)
	);

	// Cache pour le comptage des mots par verset
	const verseWordCountCache = new Map<string, number>();
	const getVerseWordCount = async (surah: number, verse: number): Promise<number | null> => {
		const key = `${surah}:${verse}`;
		const cached = verseWordCountCache.get(key);
		if (cached !== undefined) return cached;

		const verseData = await Quran.getVerse(surah, verse);
		if (!verseData) return null;

		const count = verseData.words.length;
		verseWordCountCache.set(key, count);
		return count;
	};

	// Détection des gaps de couverture
	const coverageGapIndices = await detectCoverageGapIndices(orderedSegments, {
		getVerseWordCount,
		getVerseCount: (surah) => Quran.getVerseCount(surah),
		getSurahCount: () => Quran.getSurahs().length
	});

	const segmentErrors: string[] = [];

	// Parcours des segments pour construire les templates
	for (let segmentIndex = 0; segmentIndex < orderedSegments.length; segmentIndex += 1) {
		if (segmentIndex > 0 && segmentIndex % UI_YIELD_INTERVAL === 0) await yieldToUi();
		const segment = orderedSegments[segmentIndex];
		if (segment.error) {
			console.warn('Segment has error:', segment);
			segmentErrors.push(segment.error);
			continue;
		}

		const startMs: number = Math.max(0, Math.round((segment.time_from ?? 0) * 1000));
		const endMs: number = Math.max(startMs, Math.round((segment.time_to ?? 0) * 1000));
		const confidence: number | null = segment.confidence ?? null;
		const isLowConfidence: boolean = segment.confidence !== undefined && segment.confidence <= 0.75;
		const needsCoverageReview: boolean =
			coverageGapIndices.has(segmentIndex) ||
			segment.has_missing_words === true ||
			segment.potentially_undersegmented === true;

		// Types prédéfinis (Basmala, Isti'adha, etc.)
		const predefinedType: PredefinedType | null = getPredefinedType(
			segment.ref_from,
			segment.special_type
		);
		if (predefinedType) {
			clipTemplates.push({
				kind: 'predefined',
				segment,
				originalStartMs: startMs,
				originalEndMs: endMs,
				predefinedType,
				confidence,
				isLowConfidence,
				segmentWords: getSegmentWords(segment)
			});
			continue;
		}

		const startRef: VerseRef | null = parseVerseRef(segment.ref_from);
		const endRef: VerseRef | null = parseVerseRef(segment.ref_to);
		if (!startRef || !endRef) {
			console.warn('Invalid verse reference:', segment);
			continue;
		}

		// Segment cross-verse (plusieurs versets dans un même segment)
		const isCrossVerse = startRef.surah !== endRef.surah || startRef.verse !== endRef.verse;
		if (isCrossVerse && startRef.surah === endRef.surah && startRef.verse <= endRef.verse) {
			console.warn('Cross-verse segment detected, splitting into multiple clips', {
				segment,
				startRef,
				endRef
			});
			await processCrossVerseSegment(
				{
					segment,
					startMs,
					endMs,
					startRef,
					endRef,
					confidence,
					isLowConfidence,
					needsCoverageReview,
					segmentationSource,
					includeWbwTimestamps,
					modelName
				},
				clipTemplates
			);
			continue;
		}

		// Segment normal (dans un seul verset)
		const verse = await Quran.getVerse(startRef.surah, startRef.verse);
		if (!verse) {
			console.warn('Verse not found for segment:', segment);
			continue;
		}

		const verseWordCount = verse.words.length;
		if (verseWordCount === 0) {
			console.error('Verse has no word data, skipping segment', { segment, startRef, endRef });
			continue;
		}

		const clampIndex = (value: number) => Math.min(Math.max(value, 0), verseWordCount - 1);
		const rawStartIndex = startRef.word - 1;
		const rawEndIndex = endRef.word - 1;
		let startIndex = clampIndex(rawStartIndex);
		let endIndex = clampIndex(rawEndIndex);
		let clipNeedsReview = false;

		if (
			rawStartIndex < 0 ||
			rawStartIndex >= verseWordCount ||
			rawEndIndex < 0 ||
			rawEndIndex >= verseWordCount
		) {
			clipNeedsReview = true;
		}

		if (startIndex > endIndex) {
			clipNeedsReview = true;
			[startIndex, endIndex] = [endIndex, startIndex];
		}

		await pushSubtitleTemplate(
			{
				segment,
				startMs,
				endMs,
				surah: startRef.surah,
				verseNumber: startRef.verse,
				startIndex,
				endIndex,
				verse,
				confidence,
				isLowConfidence,
				needsReview: clipNeedsReview,
				needsCoverageReview
			},
			clipTemplates
		);
	}

	// Si aucun template, erreur
	if (clipTemplates.length === 0 && segmentErrors.length > 0) {
		const uniqueErrors = [...new Set(segmentErrors)];
		return {
			status: 'failed',
			message: `All segments failed to process: ${uniqueErrors.join(', ')}`
		};
	}

	// Matérialisation dans un tableau plat (non réactif) — voir materializeTemplate.
	const builtClips: Array<SubtitleClip | PredefinedSubtitleClip> = [];
	for (let templateIndex = 0; templateIndex < clipTemplates.length; templateIndex += 1) {
		if (templateIndex > 0 && templateIndex % UI_YIELD_INTERVAL === 0) await yieldToUi();
		const template = clipTemplates[templateIndex];
		await materializeTemplate(
			project,
			subtitleTrack,
			template,
			template.originalStartMs,
			template.originalEndMs,
			template.originalStartMs,
			template.originalEndMs,
			segmentationSource,
			segmentsApplied,
			lowConfidenceSegments,
			{ value: coverageGapSegmentsNum },
			reviewSegments,
			storedAlignedSegments,
			builtClips
		);
	}

	// Récupération du compteur coverage gap
	coverageGapSegmentsNum = storedAlignedSegments.length > 0 ? 0 : coverageGapSegmentsNum; // reset - sera recalculé

	// Post-processing sur le tableau plat, puis UNE seule assignation réactive de
	// `subtitleTrack.clips` : la timeline/preview ne se re-render qu'une fois au
	// lieu d'une fois par clip.
	builtClips.sort((a, b) => a.startTime - b.startTime);
	closeSmallSubtitleGaps(builtClips);

	let finalClips: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>;
	if (fillBySilence) {
		finalClips = insertSilenceClips(builtClips);
		if (extendBeforeSilence && extendBeforeSilenceMs > 0) {
			extendSubtitlesBeforeSilence(finalClips, extendBeforeSilenceMs);
		}
	} else {
		extendSubtitlesToFillGaps(builtClips);
		finalClips = builtClips;
	}
	finalClips.sort((a, b) => a.startTime - b.startTime);
	subtitleTrack.clips = finalClips;

	// Mise à jour des timestamps dans les segments alignés.
	// Index clip-par-id construit une seule fois : `getClipById` fait un scan
	// linéaire, donc le rappeler par segment donnait un coût O(n²) qui bloquait
	// le thread après l'affichage des cartes sur une longue sourate.
	const clipsById = new Map<number, (typeof subtitleTrack.clips)[number]>();
	for (const clip of subtitleTrack.clips) clipsById.set(clip.id, clip);
	for (const storedAlignedSegment of storedAlignedSegments) {
		const clip = clipsById.get(storedAlignedSegment.clipId);
		if (!clip) continue;
		storedAlignedSegment.startMs = clip.startTime;
		storedAlignedSegment.endMs = clip.endTime;
	}

	// Mise à jour de l'UI et du contexte
	const verseRange: VerseRange = VerseRange.getVerseRangeFromClips(
		subtitleTrack.clips.filter((clip) => clip.type === 'Subtitle') as SubtitleClip[],
		0,
		subtitleTrack.getDuration().ms
	);
	const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio) as AssetTrack;
	project.detail.updateVideoDetailAttributesForTracks(audioTrack, subtitleTrack);
	if (!headless) globalState.updateVideoPreviewUI();
	project.projectEditorState.subtitlesEditor.initialLowConfidenceCount = reviewSegments.value;
	project.projectEditorState.subtitlesEditor.segmentationContext = {
		audioId: response.audio_id ?? null,
		source: segmentationSource,
		effectiveMode,
		modelName: modelName ?? null,
		device: device ?? null,
		includeWbwTimestamps,
		alignedSegments: storedAlignedSegments
	};

	if (payloadForLog !== undefined) {
		console.log('Quran segmentation payload:', payloadForLog);
	}

	// Compter les coverage gaps
	let coverageGapSegmentsResult = 0;
	for (const clip of subtitleTrack.clips) {
		if (clip instanceof SubtitleClip && clip.needsCoverageReview) {
			coverageGapSegmentsResult += 1;
		}
	}

	return {
		status: 'completed',
		segmentsApplied: segmentsApplied.value,
		lowConfidenceSegments: lowConfidenceSegments.value,
		coverageGapSegments: coverageGapSegmentsResult,
		verseRange,
		fallbackToCloud,
		cloudGpuFallbackToCpu,
		warning: response.warning ?? warningOverride,
		requestedMode,
		effectiveMode
	};
}
