export type ExportSubtitleCaptureClip = {
	startTime: number;
	endTime: number;
	kind: 'subtitle' | 'silence' | 'predefined';
	surah?: number;
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

/**
 * Construit une signature d'état déterministe des overlays temporisés visibles à un instant donné.
 *
 * Cette signature sert à comparer deux instants pendant un même sous-titre:
 * si la signature est identique, la frame peut être dupliquée; sinon une nouvelle capture est requise.
 */
export function getTimedOverlayStateAt(
	timing: number,
	timedOverlayClips: ExportTimedOverlayCaptureClip[]
): string {
	// Analyse l'état des overlays temporisés à un instant donné.
	// Retourne une signature stable basée sur les overlays visibles.
	const visibleTimedOverlays: string[] = [];

	for (const clip of timedOverlayClips) {
		if (!isTimedOverlayVisibleAt(clip, timing)) continue;
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
	blankImgs: { [surah: number]: number[] },
	t: number
): {
	hasIt: boolean;
	surah: number | null;
} {
	for (const [surahNumb, timings] of Object.entries(blankImgs)) {
		if (timings.includes(t)) return { hasIt: true, surah: Number(surahNumb) };
	}

	return { hasIt: false, surah: null };
}

export function hasBlankImg(
	imgWithNothingShown: { [surah: number]: number },
	surah: number
): boolean {
	return imgWithNothingShown[surah] !== undefined;
}

type CalculateCaptureTimingParams = {
	rangeStart: number;
	rangeEnd: number;
	fadeDuration: number;
	subtitleClips: ExportSubtitleCaptureClip[];
	timedOverlayClips: ExportTimedOverlayCaptureClip[];
	getCurrentSurah: (time: number) => number;
};

export function calculateCaptureTimingsForRange({
	rangeStart,
	rangeEnd,
	fadeDuration,
	subtitleClips,
	timedOverlayClips,
	getCurrentSurah
}: CalculateCaptureTimingParams) {
	const timingsToTakeScreenshots: number[] = [rangeStart, rangeEnd];
	const imgWithNothingShown: { [surah: number]: number } = {}; // Timing ou rien n'est affiche (pour dupliquer)
	const blankImgs: { [surah: number]: number[] } = {};
	// Map des timings duplicables: target -> source.
	const duplicableTimings: Map<number, number> = new Map();

	function add(t: number | undefined | null) {
		if (t == null) return;
		if (t < rangeStart || t > rangeEnd) return;
		timingsToTakeScreenshots.push(Math.round(t));
	}

	// --- Sous-titres ---
	for (const clip of subtitleClips) {
		const { startTime, endTime } = clip;
		if (endTime < rangeStart || startTime > rangeEnd) continue;

		const duration = endTime - startTime;
		if (duration <= 0) continue;

		if (clip.kind !== 'silence') {
			const fadeInEnd = Math.min(startTime + fadeDuration, endTime);
			const fadeOutStart = endTime - fadeDuration;

			// Vérifier si on peut optimiser les captures pour ce sous-titre
			// L'idée : si les custom clips visibles sont identiques entre fadeInEnd et fadeOutStart,
			// on peut prendre une seule capture et la dupliquer, économisant du temps
			if (fadeOutStart > startTime && fadeInEnd !== fadeOutStart) {
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

			add(endTime);
		} else {
			// Clip de silence: pas de bornes fade-in/fade-out à ajouter.
			const surah = getCurrentSurah(clip.startTime);
			if (imgWithNothingShown[surah] === undefined) {
				add(endTime);
			} else {
				if (!blankImgs[surah]) blankImgs[surah] = [];
				blankImgs[surah].push(Math.round(endTime));
			}
		}

		// Si aucun overlay temporel n'est visible à la fin du clip, on peut réutiliser un blank.
		const hasTimedOverlayAtEndTime = timedOverlayClips.some((timedOverlayClip) => {
			return isTimedOverlayVisibleAt(timedOverlayClip, endTime);
		});

		if (!hasTimedOverlayAtEndTime) {
			const surah = getCurrentSurah(clip.startTime);
			if (imgWithNothingShown[surah] === undefined) {
				imgWithNothingShown[surah] = Math.round(endTime);
			} else {
				if (!blankImgs[surah]) blankImgs[surah] = [];
				blankImgs[surah].push(Math.round(endTime));
			}
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

	return { uniqueSorted, imgWithNothingShown, blankImgs, duplicableTimings };
}
