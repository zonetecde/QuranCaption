export type ExportSubtitleCaptureClip = {
	startTime: number;
	endTime: number;
	kind: 'subtitle' | 'silence' | 'predefined';
	surah?: number;
};

export type ExportCustomTextCaptureClip = {
	id: number;
	startTime?: number | null;
	endTime?: number | null;
	alwaysShow: boolean;
};

export function getCustomClipStateAt(
	timing: number,
	customTextClips: ExportCustomTextCaptureClip[]
): string {
	/**
	 * Analyser l'etat des custom clips a un moment donne
	 * Retourne un identifiant unique basé sur quels custom clips sont visibles
	 */
	const visibleCustomClips: string[] = [];

	for (const clip of customTextClips) {
		// Ignorer les custom texts always visible comme demandé
		if (clip.alwaysShow) continue;
		if (clip.startTime == null || clip.endTime == null) continue;

		// Vérifier si ce custom text est visible au timing donné (inclusive des bornes)
		if (timing >= clip.startTime && timing <= clip.endTime) {
			// Créer une clé unique basée sur l'ID du clip et ses propriétés temporelles
			visibleCustomClips.push(`${clip.id}-${clip.startTime}-${clip.endTime}`);
		}
	}

	// Retourner un hash des custom texts visibles, triés pour la cohérence
	return visibleCustomClips.sort().join('|');
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
		// Prend le clip de sous-titre précédent
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
	customTextClips: ExportCustomTextCaptureClip[];
	getCurrentSurah: (time: number) => number;
};

export function calculateCaptureTimingsForRange({
	rangeStart,
	rangeEnd,
	fadeDuration,
	subtitleClips,
	customTextClips,
	getCurrentSurah
}: CalculateCaptureTimingParams) {
	const timingsToTakeScreenshots: number[] = [rangeStart, rangeEnd];
	const imgWithNothingShown: { [surah: number]: number } = {}; // Timing où rien n'est affiché (pour dupliquer)
	const blankImgs: { [surah: number]: number[] } = {};
	// Map pour stocker les timings qui peuvent être dupliqués
	const duplicableTimings: Map<number, number> = new Map(); // source -> target

	function add(t: number | undefined) {
		if (t === undefined) return;
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
				// Récupère les customs clips visibles aux deux timings pour voir si possibilité de duplication
				const customClipStateAtFadeInEnd = getCustomClipStateAt(fadeInEnd, customTextClips);
				const customClipStateAtFadeOutStart = getCustomClipStateAt(
					fadeOutStart,
					customTextClips
				);

				// Si l'état des custom clips est identique, on peut dupliquer
				if (customClipStateAtFadeInEnd === customClipStateAtFadeOutStart) {
					add(fadeInEnd);
					// Ajoute a la map de duplication
					duplicableTimings.set(Math.round(fadeOutStart), Math.round(fadeInEnd));
				} else {
					// Etats differents, prendre les deux captures
					add(fadeInEnd);
					add(fadeOutStart);
				}
			} else {
				add(fadeInEnd);
				if (fadeOutStart > startTime) add(fadeOutStart);
			}

			add(endTime);
		} else {
			// Silence clip detected, skipping fade-in/out timings.
			const surah = getCurrentSurah(clip.startTime);
			if (imgWithNothingShown[surah] === undefined) {
				add(endTime);
			} else {
				if (!blankImgs[surah]) blankImgs[surah] = [];
				blankImgs[surah].push(Math.round(endTime));
			}
		}

		const hasTimedCustomTextAtEndTime = customTextClips.some((clip) => {
			if (clip.alwaysShow) {
				return false;
			}

			return clip.startTime != null && clip.endTime != null && clip.startTime <= endTime && clip.endTime >= endTime;
		});

		if (!hasTimedCustomTextAtEndTime) {
			const surah = getCurrentSurah(clip.startTime);
			if (imgWithNothingShown[surah] === undefined) {
				imgWithNothingShown[surah] = Math.round(endTime);
			} else {
				if (!blankImgs[surah]) blankImgs[surah] = [];
				blankImgs[surah].push(Math.round(endTime));
			}
		}
	}

	// --- Custom Texts ---
	for (const clip of customTextClips) {
		const { startTime, endTime, alwaysShow } = clip;
		if (startTime == null || endTime == null) continue;
		if (endTime < rangeStart || startTime > rangeEnd) continue;

		const duration = endTime - startTime;
		if (duration <= 0) continue;

		if (alwaysShow) {
			add(startTime);
			add(endTime);
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
