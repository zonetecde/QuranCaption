import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import type { SegmentationWordTimestamp } from '$lib/services/AutoSegmentation';

/**
 * Calcule les instants d'overlay à matérialiser pendant l'export vidéo.
 *
 * L'export ne capture pas chaque frame de la vidéo. Il capture seulement des timings clés
 * (`uniqueSorted`), puis FFmpeg réutilise les PNG numérotés pour composer les fades.
 *
 * Pour le WBW, un clip de sous-titre peut contribuer à plusieurs captures si son groupe de merge
 * visuel arabe contient plusieurs segments. Le texte reste affiché une seule fois, mais chaque
 * mot conserve toutes ses occurrences temporelles pour que l'export capture le bon highlight au
 * bon instant, y compris sur les mots partagés entre deux segments merged.
 *
 * Règle importante pour les blanks:
 * - une frame blank est une frame sans sous-titre affiché, mais elle peut encore contenir des
 *   overlays visibles: custom text, nom de sourate, nom du récitant, etc.;
 * - chaque blank nécessaire doit rester dans `uniqueSorted`, même si elle est duplicable, parce que
 *   la boucle d'export doit créer physiquement le PNG numéroté attendu par FFmpeg;
 * - `imgWithNothingShown` contient la première blank source capturée pour un état visuel donné;
 * - `blankImgs` contient les timings numérotés qui doivent être créés par copie depuis cette source;
 * - l'état visuel d'une blank est identifié par `surah + overlays temporisés visibles`.
 *
 * Conséquence: deux blanks peuvent être dupliquées uniquement si elles ont exactement le même état
 * visuel. Une blank avec nom de sourate, nom du récitant ou custom text visible ne doit pas servir
 * de source à une blank où ces éléments sont absents, et inversement.
 */
export type ExportSubtitleCaptureClip = {
	startTime: number;
	endTime: number;
	kind: 'subtitle' | 'silence' | 'predefined';
	surah?: number;
	id?: number;
	visualMergeGroupId?: string | null;
	visualMergeMode?: 'arabic' | 'translation' | 'both' | null;
	/**
	 * Timings WBW absolus à capturer pour ce clip.
	 *
	 * Quand le sous-titre appartient à un merge visuel arabe, cette liste peut agréger les
	 * timestamps de plusieurs clips du groupe. Le texte reste rendu une seule fois, mais chaque
	 * mot partagé conserve ses propres occurrences temporelles pour que l'export capture le bon
	 * highlight au bon moment.
	 */
	wbwHighlightTimings?: number[];
};

export type ExportSubtitleWbwSourceClip = Pick<
	SubtitleClip,
	'id' | 'startTime' | 'endTime' | 'visualMergeGroupId' | 'visualMergeMode'
> & {
	alignmentMetadata?: {
		timeFrom?: number;
		words: SegmentationWordTimestamp[];
	} | null;
};

export type ExportSubtitleWbwTimingOptions = {
	clip: ExportSubtitleWbwSourceClip;
	subtitleClips: ExportSubtitleWbwSourceClip[];
	isWbwEnabledForClipId: (clipId: number) => boolean;
};

export type ExportTimedOverlayCaptureClip = {
	id: number | string;
	startTime?: number | null;
	endTime?: number | null;
	alwaysShow: boolean;
	captureBoundariesWhenAlwaysShow?: boolean;
	isVisibleAt?: (timing: number) => boolean;
};

export type ExportCustomTextCaptureClip = ExportTimedOverlayCaptureClip;

export type BlankTimingMatch = {
	hasIt: boolean;
	key: string | null;
	surah: number | null;
};

/**
 * Indique si un overlay temporisé est visible à un instant donné.
 * - Un clip `alwaysShow` est ignoré par défaut car il n'introduit pas de variation temporelle
 *   utile pour l'optimisation des captures.
 * - Le clip doit avoir un intervalle valide (`startTime`/`endTime`) et le temps demandé
 *   doit être inclus dans cet intervalle.
 * - Si `isVisibleAt` est fourni, il agit comme garde-fou final (ex: dépendance au sous-titre actif).
 */
function isTimedOverlayVisibleAt(
	clip: ExportTimedOverlayCaptureClip,
	timing: number,
	ignoreAlwaysShow: boolean = true
): boolean {
	if (ignoreAlwaysShow && clip.alwaysShow) return false;
	if (clip.startTime == null || clip.endTime == null) return false;
	if (timing < clip.startTime || timing > clip.endTime) return false;
	if (clip.isVisibleAt && !clip.isVisibleAt(timing)) return false;
	return true;
}

function isArabicVisualMergeClip(clip: ExportSubtitleWbwSourceClip): boolean {
	return clip.visualMergeMode === 'arabic' || clip.visualMergeMode === 'both';
}

function getSubtitleMergeGroupClips(
	clip: ExportSubtitleWbwSourceClip,
	subtitleClips: ExportSubtitleWbwSourceClip[]
): ExportSubtitleWbwSourceClip[] {
	if (!clip.visualMergeGroupId || !isArabicVisualMergeClip(clip)) {
		return [clip];
	}

	const mergedClips = subtitleClips.filter(
		(candidate) =>
			candidate.visualMergeGroupId === clip.visualMergeGroupId &&
			candidate.visualMergeMode === clip.visualMergeMode
	);

	return mergedClips.length > 0 ? mergedClips : [clip];
}

/**
 * Retourne les timings WBW d'un sous-titre pour l'export.
 *
 * Si le clip appartient à un merge visuel arabe, on agrège les timestamps WBW de tous les clips
 * du groupe au lieu de ne garder que le clip courant. Cela permet d'exporter une capture à chaque
 * changement de mot pertinent, y compris pour les mots partagés entre deux sous-titres merged.
 *
 * Le clip de référence sert uniquement à vérifier si le WBW est activé pour le groupe.
 *
 * @param {ExportSubtitleWbwTimingOptions} options Options de résolution des timings WBW.
 * @returns {number[] | undefined} Timings absolus en millisecondes, ou `undefined` si inactif.
 */
export function getExportWordByWordHighlightTimings({
	clip,
	subtitleClips,
	isWbwEnabledForClipId
}: ExportSubtitleWbwTimingOptions): number[] | undefined {
	if ((clip.alignmentMetadata?.words.length ?? 0) === 0) return undefined;

	const mergedClips = getSubtitleMergeGroupClips(clip, subtitleClips);
	const referenceClip = mergedClips[0] ?? clip;
	if (!isWbwEnabledForClipId(referenceClip.id)) return undefined;

	const timings = mergedClips.flatMap((sourceClip) => {
		if ((sourceClip.alignmentMetadata?.words.length ?? 0) === 0) return [];

		const baseTimeS = sourceClip.alignmentMetadata?.timeFrom ?? sourceClip.startTime / 1000;
		return (sourceClip.alignmentMetadata?.words ?? [])
			.map((word: SegmentationWordTimestamp) => Math.round((baseTimeS + word.start) * 1000))
			.filter((timing: number) => timing >= sourceClip.startTime && timing <= sourceClip.endTime);
	});

	return timings.length > 0
		? Array.from(new Set<number>(timings)).sort((a, b) => a - b)
		: undefined;
}

/**
 * Construit une signature d'état déterministe des overlays temporisés visibles à un instant donné.
 *
 * Cette signature sert à comparer deux instants pendant un même sous-titre:
 * si la signature est identique, la frame peut être dupliquée; sinon une nouvelle capture est requise.
 */
export function getTimedOverlayStateAt(
	timing: number,
	timedOverlayClips: ExportTimedOverlayCaptureClip[],
	ignoreAlwaysShow: boolean = true
): string {
	// Analyse l'état des overlays temporisés à un instant donné.
	// Retourne une signature stable basée sur les overlays visibles.
	const visibleTimedOverlays: string[] = [];

	for (const clip of timedOverlayClips) {
		if (!isTimedOverlayVisibleAt(clip, timing, ignoreAlwaysShow)) continue;
		// Cle unique basée sur l'ID du clip et sa fenêtre temporelle.
		visibleTimedOverlays.push(`${clip.id}-${clip.startTime}-${clip.endTime}`);
	}

	// Signature triée pour rester déterministe quel que soit l'ordre d'entrée.
	return visibleTimedOverlays.sort().join('|');
}

export function getCustomClipStateAt(
	timing: number,
	customTextClips: ExportCustomTextCaptureClip[]
): string {
	return getTimedOverlayStateAt(timing, customTextClips);
}

export function getBlankVisualStateKey(
	surah: number,
	timing: number,
	timedOverlayClips: ExportTimedOverlayCaptureClip[]
): string {
	const timedOverlayState = getTimedOverlayStateAt(timing, timedOverlayClips, false);
	return `surah:${surah}|overlays:${timedOverlayState}`;
}

export function getBlankImageFileName(blankVisualStateKey: string): string {
	return `blank_${encodeURIComponent(blankVisualStateKey)}`;
}

function getSurahFromBlankVisualStateKey(blankVisualStateKey: string): number | null {
	const match = /^surah:(-?\d+)\|/.exec(blankVisualStateKey);
	return match ? Number(match[1]) : null;
}

export function resolveCurrentSurahFromClips(
	clips: Array<Pick<ExportSubtitleCaptureClip, 'startTime' | 'endTime' | 'surah'>>,
	cursorPos: number
): number {
	const currentClip =
		clips.find((clip) => cursorPos >= clip.startTime && cursorPos <= clip.endTime) ?? null;

	if (typeof currentClip?.surah === 'number') {
		return currentClip.surah;
	}

	if (currentClip !== null) {
		// Prend d'abord le clip de sous-titre precedent autour du curseur.
		const currentIndex = clips.indexOf(currentClip);

		for (let i = currentIndex - 1; i >= 0; i--) {
			const clip = clips[i];
			if (typeof clip.surah === 'number') {
				return clip.surah;
			}
		}

		for (let i = currentIndex + 1; i < clips.length; i++) {
			const clip = clips[i];
			if (typeof clip.surah === 'number') {
				return clip.surah;
			}
		}
	} else {
		// Si on est dans un petit trou entre deux clips (souvent causé par des timings décimaux),
		// prendre d'abord le dernier sous-titre avant le curseur, sinon le prochain.
		const indexAfter = clips.findIndex((clip) => cursorPos < clip.startTime);

		if (indexAfter === -1) {
			for (let i = clips.length - 1; i >= 0; i--) {
				const clip = clips[i];
				if (typeof clip.surah === 'number') {
					return clip.surah;
				}
			}
		} else {
			for (let i = indexAfter - 1; i >= 0; i--) {
				const clip = clips[i];
				if (typeof clip.surah === 'number') {
					return clip.surah;
				}
			}

			for (let i = indexAfter; i < clips.length; i++) {
				const clip = clips[i];
				if (typeof clip.surah === 'number') {
					return clip.surah;
				}
			}
		}
	}

	return -1;
}

export function hasTiming(
	blankImgs: { [blankVisualStateKey: string]: number[] },
	t: number
): BlankTimingMatch {
	for (const [blankVisualStateKey, timings] of Object.entries(blankImgs)) {
		if (timings.includes(t)) {
			return {
				hasIt: true,
				key: blankVisualStateKey,
				surah: getSurahFromBlankVisualStateKey(blankVisualStateKey)
			};
		}
	}

	return { hasIt: false, key: null, surah: null };
}

export function hasBlankImg(
	imgWithNothingShown: { [blankVisualStateKey: string]: number },
	blankVisualStateKey: string | number
): boolean {
	if (typeof blankVisualStateKey === 'number') {
		return Object.keys(imgWithNothingShown).some(
			(key) => getSurahFromBlankVisualStateKey(key) === blankVisualStateKey
		);
	}

	return imgWithNothingShown[blankVisualStateKey] !== undefined;
}

/**
 * Indique si la fin du clip courant correspond a une transition interne d'un merge visuel.
 *
 * Dans ce cas, la frame de fin ne doit jamais etre traitee comme un `blank` reutilisable,
 * car une partie du contenu fusionne peut encore rester visible pendant la transition.
 *
 * @param {ExportSubtitleCaptureClip[]} clips Liste ordonnee des clips de capture.
 * @param {number} clipIndex Index du clip courant.
 * @returns {boolean} `true` si la fin du clip est une transition interne de merge visuel.
 */
function isInternalVisualMergeTransition(
	clips: ExportSubtitleCaptureClip[],
	clipIndex: number
): boolean {
	const currentClip = clips[clipIndex];
	const nextClip = clips[clipIndex + 1];

	if (currentClip?.kind !== 'subtitle' || nextClip?.kind !== 'subtitle') return false;
	if (
		!currentClip.visualMergeGroupId ||
		currentClip.visualMergeGroupId !== nextClip.visualMergeGroupId
	)
		return false;
	if (!currentClip.visualMergeMode || currentClip.visualMergeMode !== nextClip.visualMergeMode)
		return false;

	return nextClip.startTime <= currentClip.endTime + 1;
}

type CalculateCaptureTimingParams = {
	rangeStart: number;
	rangeEnd: number;
	fadeDuration: number;
	subtitleClips: ExportSubtitleCaptureClip[];
	timedOverlayClips: ExportTimedOverlayCaptureClip[];
	getCurrentSurah: (time: number) => number;
};

export type ExportCaptureTimingResult = {
	uniqueSorted: number[];
	imgWithNothingShown: { [blankVisualStateKey: string]: number };
	blankImgs: { [blankVisualStateKey: string]: number[] };
	duplicableTimings: Map<number, number>;
	exactCaptureTimings: Set<number>;
	exactCaptureTimingValues: Map<number, number>;
};

export type ExportFrameCaptureJob = {
	kind: 'capture';
	timing: number;
	captureTiming: number;
	imageIndex: number;
	fileName: string;
	isBlankImage: boolean;
	reusableBlankFileName: string | null;
};

export type ExportFrameCopyJob = {
	kind: 'copy';
	timing: number;
	sourceFileName: string;
	targetFileName: number;
	reason: 'duplicable' | 'blank';
};

export type ExportBlankSourceJob = {
	kind: 'blankSource';
	timing: number;
	captureTiming: number;
	fileName: string;
	blankVisualStateKey: string;
};

export type ExportCaptureJobPlan = {
	blankSourceJobs: ExportBlankSourceJob[];
	captureJobs: ExportFrameCaptureJob[];
	copyJobs: ExportFrameCopyJob[];
	workerBuckets: ExportFrameCaptureJob[][];
	blankImageIndexes: number[];
	totalJobs: number;
};

type BuildExportCaptureJobPlanParams = {
	timings: ExportCaptureTimingResult;
	rangeStart: number;
	rangeEnd: number;
	fadeDuration: number;
	workerCount: number;
	isBlankCaptureTiming: (timing: number) => boolean;
	getReusableBlankFileName: (timing: number) => string | null;
	getBlankSourceCaptureTiming?: (timing: number) => number;
};

export function calculateCaptureTimingsForRange({
	rangeStart,
	rangeEnd,
	fadeDuration,
	subtitleClips,
	timedOverlayClips,
	getCurrentSurah
}: CalculateCaptureTimingParams): ExportCaptureTimingResult {
	const timingsToTakeScreenshots: number[] = [rangeStart, rangeEnd];
	const imgWithNothingShown: { [blankVisualStateKey: string]: number } = {}; // Timing ou rien n'est affiche (pour dupliquer)
	const blankImgs: { [blankVisualStateKey: string]: number[] } = {};
	// Map des timings duplicables: target -> source.
	const duplicableTimings: Map<number, number> = new Map();
	// Timings qui doivent etre captures sans avancer le curseur,
	// sinon on tombe dans le trou entre deux clips merges.
	const exactCaptureTimings: Set<number> = new Set();
	const exactCaptureTimingValues: Map<number, number> = new Map();

	function add(t: number | undefined | null) {
		if (t == null) return;
		if (t < rangeStart || t > rangeEnd) return;
		timingsToTakeScreenshots.push(Math.round(t));
	}

	function registerBlankTiming(timing: number, surah: number, visualStateTiming: number = timing) {
		const roundedTiming = Math.round(timing);
		const blankVisualStateKey = getBlankVisualStateKey(surah, visualStateTiming, timedOverlayClips);

		if (imgWithNothingShown[blankVisualStateKey] === undefined) {
			imgWithNothingShown[blankVisualStateKey] = roundedTiming;
		} else if (imgWithNothingShown[blankVisualStateKey] !== roundedTiming) {
			if (!blankImgs[blankVisualStateKey]) blankImgs[blankVisualStateKey] = [];
			if (!blankImgs[blankVisualStateKey].includes(roundedTiming)) {
				blankImgs[blankVisualStateKey].push(roundedTiming);
			}
		}

		add(roundedTiming);
	}

	// --- Sous-titres ---
	for (let clipIndex = 0; clipIndex < subtitleClips.length; clipIndex++) {
		const clip = subtitleClips[clipIndex];
		const { startTime, endTime } = clip;
		if (endTime < rangeStart || startTime > rangeEnd) continue;

		const duration = endTime - startTime;
		if (duration <= 0) continue;
		const endsInsideVisualMerge = isInternalVisualMergeTransition(subtitleClips, clipIndex);
		const endsInsideFullVisualMerge = endsInsideVisualMerge && clip.visualMergeMode === 'both';
		if (endsInsideVisualMerge && !endsInsideFullVisualMerge) {
			const roundedEndTime = Math.round(endTime);
			exactCaptureTimings.add(roundedEndTime);
			exactCaptureTimingValues.set(roundedEndTime, endTime);
		}

		if (clip.kind !== 'silence') {
			const fadeInEnd = Math.min(startTime + fadeDuration, endTime);
			const fadeOutStart = endTime - fadeDuration;
			const wbwHighlightTimings = (clip.wbwHighlightTimings ?? []).filter(
				(timing) => timing >= startTime && timing <= endTime
			);
			const hasWbwHighlightTimings = wbwHighlightTimings.length > 0;

			for (const timing of wbwHighlightTimings) {
				add(timing);
			}

			// Vérifier si on peut optimiser les captures pour ce sous-titre
			// L'idée : si les custom clips visibles sont identiques entre fadeInEnd et fadeOutStart,
			// on peut prendre une seule capture et la dupliquer, économisant du temps
			if (
				!hasWbwHighlightTimings &&
				Math.round(fadeOutStart) !== Math.round(endTime) &&
				fadeOutStart > startTime &&
				fadeInEnd !== fadeOutStart
			) {
				// Compare l'état des overlays temporels aux deux bornes utiles du sous-titre.
				const timedOverlayStateAtFadeInEnd = getTimedOverlayStateAt(fadeInEnd, timedOverlayClips);
				const timedOverlayStateAtFadeOutStart = getTimedOverlayStateAt(
					fadeOutStart,
					timedOverlayClips
				);

				// Si l'état est identique, une seule capture suffit.
				if (timedOverlayStateAtFadeInEnd === timedOverlayStateAtFadeOutStart) {
					add(fadeInEnd);
					// Ajoute la relation de duplication (target -> source).
					duplicableTimings.set(Math.round(fadeOutStart), Math.round(fadeInEnd));
				} else {
					// États différents, il faut capturer les deux timings.
					add(fadeInEnd);
					add(fadeOutStart);
				}
			} else {
				add(fadeInEnd);
				if (fadeOutStart > startTime) add(fadeOutStart);
			}

			if (!endsInsideFullVisualMerge) add(endTime);
		} else {
			// Clip de silence: pas de bornes fade-in/fade-out à ajouter.
			const surah = getCurrentSurah(clip.startTime);
			registerBlankTiming(endTime, surah);
		}

		const nextClip = subtitleClips[clipIndex + 1];
		const endsIntoNextVisibleClip =
			nextClip && nextClip.kind !== 'silence' && nextClip.startTime <= endTime + 1;
		const startsAtNextVisibleClipBoundary =
			nextClip &&
			nextClip.kind !== 'silence' &&
			nextClip.startTime >= endTime &&
			nextClip.startTime <= endTime + 1;
		const shouldRegisterEndingBlank =
			clip.kind !== 'silence' &&
			!endsInsideVisualMerge &&
			(!endsIntoNextVisibleClip || (fadeDuration > 0 && startsAtNextVisibleClipBoundary));
		if (shouldRegisterEndingBlank) {
			const surah = getCurrentSurah(clip.startTime);
			registerBlankTiming(endTime, surah, endTime + 1);
		}
	}

	// --- Overlays temporisés (custom text + overlays globaux) ---
	for (const clip of timedOverlayClips) {
		const { startTime, endTime, alwaysShow } = clip;
		if (startTime == null || endTime == null) continue;
		if (endTime < rangeStart || startTime > rangeEnd) continue;

		const duration = endTime - startTime;
		if (duration <= 0) continue;

		if (alwaysShow) {
			if (clip.captureBoundariesWhenAlwaysShow) {
				add(startTime);
				add(endTime);
			}
			continue;
		}

		const fadeInEnd = Math.min(startTime + fadeDuration, endTime);
		add(fadeInEnd);

		const fadeOutStart = endTime - fadeDuration;
		if (fadeOutStart > startTime) add(fadeOutStart);

		add(endTime);
	}

	const uniqueSorted = Array.from(new Set(timingsToTakeScreenshots))
		.filter((t) => t >= rangeStart && t <= rangeEnd)
		.sort((a, b) => a - b);

	return {
		uniqueSorted,
		imgWithNothingShown,
		blankImgs,
		duplicableTimings,
		exactCaptureTimings,
		exactCaptureTimingValues
	};
}

/**
 * Transforme les timings d'export en jobs de capture, copie et blanks partagés.
 *
 * Le calcul conserve les formules historiques d'index PNG. Les copies sont séparées des vraies
 * captures pour pouvoir attendre que toutes les sources produites par les workers existent.
 *
 * @param {BuildExportCaptureJobPlanParams} params Données de timing et callbacks de contexte.
 * @returns {ExportCaptureJobPlan} Plan de travail prêt à exécuter.
 */
export function buildExportCaptureJobPlan({
	timings,
	rangeStart,
	rangeEnd,
	fadeDuration,
	workerCount,
	isBlankCaptureTiming,
	getReusableBlankFileName,
	getBlankSourceCaptureTiming = (timing) => timing
}: BuildExportCaptureJobPlanParams): ExportCaptureJobPlan {
	const captureJobs: ExportFrameCaptureJob[] = [];
	const copyJobs: ExportFrameCopyJob[] = [];
	const blankImageIndexes = new Set<number>();
	const normalizedWorkerCount = Math.max(1, Math.floor(workerCount));
	const workerBuckets: ExportFrameCaptureJob[][] = Array.from(
		{ length: normalizedWorkerCount },
		() => []
	);

	let base = -fadeDuration;
	for (const timing of timings.uniqueSorted) {
		const imageIndex = Math.max(Math.round(timing - rangeStart + base), 0);
		const blankTimingInfo = hasTiming(timings.blankImgs, timing);
		const isBlankImage = isBlankCaptureTiming(timing);

		if (isBlankImage) {
			blankImageIndexes.add(imageIndex);
		}

		const sourceTimingForDuplication = timings.duplicableTimings.get(timing);
		if (sourceTimingForDuplication !== undefined) {
			const sourceIndex = Math.max(
				Math.round(sourceTimingForDuplication - rangeStart - fadeDuration),
				0
			);
			copyJobs.push({
				kind: 'copy',
				timing,
				sourceFileName: `${sourceIndex}`,
				targetFileName: imageIndex,
				reason: 'duplicable'
			});
		} else if (
			blankTimingInfo.hasIt &&
			blankTimingInfo.key &&
			hasBlankImg(timings.imgWithNothingShown, blankTimingInfo.key)
		) {
			copyJobs.push({
				kind: 'copy',
				timing,
				sourceFileName: getBlankImageFileName(blankTimingInfo.key),
				targetFileName: imageIndex,
				reason: 'blank'
			});
		} else {
			const captureTiming =
				timings.exactCaptureTimingValues.get(timing) ??
				(isBlankImage || timings.exactCaptureTimings.has(timing) ? timing : timing + 1);
			const job: ExportFrameCaptureJob = {
				kind: 'capture',
				timing,
				captureTiming,
				imageIndex,
				fileName: `${imageIndex}`,
				isBlankImage,
				reusableBlankFileName: isBlankImage ? null : getReusableBlankFileName(timing)
			};
			captureJobs.push(job);

			const rangeDuration = Math.max(1, rangeEnd - rangeStart);
			const bucketIndex = Math.min(
				normalizedWorkerCount - 1,
				Math.max(0, Math.floor(((timing - rangeStart) / rangeDuration) * normalizedWorkerCount))
			);
			workerBuckets[bucketIndex].push(job);
		}

		base += fadeDuration;
	}

	const blankSourceJobs = Object.entries(timings.imgWithNothingShown).map(
		([blankVisualStateKey, timing]) => ({
			kind: 'blankSource' as const,
			timing,
			captureTiming: getBlankSourceCaptureTiming(timing),
			fileName: getBlankImageFileName(blankVisualStateKey),
			blankVisualStateKey
		})
	);

	return {
		blankSourceJobs,
		captureJobs,
		copyJobs,
		workerBuckets,
		blankImageIndexes: Array.from(blankImageIndexes).sort((a, b) => a - b),
		totalJobs: blankSourceJobs.length + captureJobs.length + copyJobs.length
	};
}
