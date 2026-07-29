import {
	ClipWithTranslation,
	PredefinedSubtitleClip,
	SubtitleClip
} from '$lib/classes/Clip.svelte';
import {
	hasCjkText,
	VerseTranslation,
	type TranslationInlineStyleFlags,
	type TranslationInlineStyleRun
} from '$lib/classes/Translation.svelte';
import type { VisualMergeGroup } from '$lib/classes/Track.svelte';

export type OverlayTextSegment = {
	key: string;
	text: string;
	flags: TranslationInlineStyleFlags;
	extraCss?: string;
};

/**
 * Indique si une cible de rendu utilise le fusion visuelle active.
 * @param {VisualMergeGroup | null} mergedGroup Groupe fusion actif.
 * @param {string} target Cible (`arabic` ou édition de traduction).
 * @returns {boolean} `true` si la cible est fusionnée.
 */
export function isVisualMergeTargetMerged(
	mergedGroup: VisualMergeGroup | null,
	target: string
): boolean {
	if (!mergedGroup) return false;
	if (target === 'arabic') return mergedGroup.mode === 'arabic' || mergedGroup.mode === 'both';
	return mergedGroup.mode === 'translation' || mergedGroup.mode === 'both';
}

/**
 * Retourne le clip de référence pour les styles d'une cible.
 * @param {SubtitleClip | PredefinedSubtitleClip | null} currentSubtitle Sous-titre courant.
 * @param {VisualMergeGroup | null} mergedGroup Groupe fusion actif.
 * @param {string} target Cible (`arabic` ou édition).
 * @returns {SubtitleClip | PredefinedSubtitleClip | null} Clip de référence.
 */
export function getReferenceClipForTarget(
	currentSubtitle: SubtitleClip | PredefinedSubtitleClip | null,
	mergedGroup: VisualMergeGroup | null,
	target: string
): SubtitleClip | PredefinedSubtitleClip | null {
	if (isVisualMergeTargetMerged(mergedGroup, target)) {
		return mergedGroup?.firstClip ?? null;
	}
	return currentSubtitle;
}

/**
 * Retourne l'id du clip de référence à utiliser pour les arrière-plans.
 * @param {VisualMergeGroup | null} mergedGroup Groupe fusion actif.
 * @param {SubtitleClip | PredefinedSubtitleClip | null} backgroundSubtitle Sous-titre de fond.
 * @param {string} target Cible (`arabic` ou édition).
 * @returns {number | undefined} Id du clip de référence.
 */
export function getBackgroundClipIdForTarget(
	mergedGroup: VisualMergeGroup | null,
	backgroundSubtitle: SubtitleClip | PredefinedSubtitleClip | null,
	target: string
): number | undefined {
	const referenceClip = isVisualMergeTargetMerged(mergedGroup, target)
		? mergedGroup?.firstClip
		: backgroundSubtitle;
	return referenceClip?.id;
}

/**
 * Construit un segment texte simple pour le rendu superposition.
 * @param {string} key Clé stable du segment.
 * @param {string} text Texte à afficher.
 * @param {string} extraCss CSS additionnel éventuel.
 * @returns {OverlayTextSegment} Segment prêt à rendre.
 */
export function createPlainOverlaySegment(
	key: string,
	text: string,
	extraCss: string = ''
): OverlayTextSegment {
	return {
		key,
		text,
		flags: {
			bold: false,
			italic: false,
			underline: false,
			color: null
		},
		extraCss
	};
}

/**
 * Concatène des groupes de segments avec un séparateur espace.
 * @param {OverlayTextSegment[][]} groups Groupes de segments.
 * @param {string} keyPrefix Préfixe de clé pour les séparateurs.
 * @returns {OverlayTextSegment[]} Liste concaténée.
 */
export function joinOverlaySegmentGroups(
	groups: OverlayTextSegment[][],
	keyPrefix: string
): OverlayTextSegment[] {
	return groups.flatMap((segments, index) => {
		if (index === 0) return segments;
		return [createPlainOverlaySegment(`${keyPrefix}-separator-${index}`, ' '), ...segments];
	});
}

/**
 * Indique si deux segments peuvent être fusionnés sans perdre de style inline.
 * @param {OverlayTextSegment} first Premier segment.
 * @param {OverlayTextSegment} second Second segment.
 * @returns {boolean} `true` si leurs styles sont identiques.
 */
function canMergeAdjacentSegments(first: OverlayTextSegment, second: OverlayTextSegment): boolean {
	return (
		first.extraCss === second.extraCss &&
		first.flags.bold === second.flags.bold &&
		first.flags.italic === second.flags.italic &&
		first.flags.underline === second.flags.underline &&
		first.flags.color === second.flags.color &&
		first.flags.lineBreak === second.flags.lineBreak
	);
}

/**
 * Ajoute des segments en évitant un noeud DOM séparé quand le séparateur est vide.
 * @param {OverlayTextSegment[]} output Segments déjà construits.
 * @param {OverlayTextSegment[]} segments Segments à ajouter.
 * @returns {void}
 */
function appendSegmentsWithoutSeparator(
	output: OverlayTextSegment[],
	segments: OverlayTextSegment[]
): void {
	const previous = output.at(-1);
	const first = segments[0];

	if (previous && first && canMergeAdjacentSegments(previous, first)) {
		output[output.length - 1] = {
			...previous,
			key: `${previous.key}-${first.key}`,
			text: previous.text + first.text
		};
		output.push(...segments.slice(1));
		return;
	}

	output.push(...segments);
}

/**
 * Tronque des exécutions inline après suppression d'un préfixe de mots.
 * @param {TranslationInlineStyleRun[] | null | undefined} runs Exécutions à ajuster.
 * @param {number} removedWords Nombre de mots retirés en tête.
 * @param {number} keptWordCount Nombre de mots conservés.
 * @returns {TranslationInlineStyleRun[]} Exécutions ajustées.
 */
export function trimInlineRunsAfterWordRemoval(
	runs: TranslationInlineStyleRun[] | null | undefined,
	removedWords: number,
	keptWordCount: number
): TranslationInlineStyleRun[] {
	if (!runs || keptWordCount <= 0) return [];

	return runs
		.map((run) => {
			const start = Math.max(0, (run.startWordIndex ?? 0) - removedWords);
			const end = Math.min(keptWordCount - 1, (run.endWordIndex ?? -1) - removedWords);
			if (start > end) return null;

			return {
				...run,
				startWordIndex: start,
				endWordIndex: end
			};
		})
		.filter((run): run is TranslationInlineStyleRun => run !== null);
}

/**
 * Extrait une tranche de mots d'un texte.
 * @param {string | null | undefined} text Texte source.
 * @param {number} removedWords Nombre de mots à ignorer au début.
 * @param {number} keptWordCount Nombre de mots à conserver.
 * @returns {string} Texte tronqué.
 */
export function trimTextWords(
	text: string | null | undefined,
	removedWords: number,
	keptWordCount: number
): string {
	if (!text) return '';
	const words = text
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0);
	return words.slice(removedWords, removedWords + keptWordCount).join(' ');
}

/**
 * Supprime les répétitions de mots entre clips fusionnés d'un même verset.
 * @param {SubtitleClip[]} clips Clips fusionnés ordonnés.
 * @returns {SubtitleClip[]} Clips normalisés sans chevauchement.
 */
export function getMergedClipsWithoutWordOverlap(clips: SubtitleClip[]): SubtitleClip[] {
	const lastEndWordByVerse = new Map<string, number>();
	const lastEndTranslationByVerseEdition = new Map<string, number>();
	const normalizedClips: SubtitleClip[] = [];

	for (const clip of clips) {
		const verseKey = `${clip.surah}:${clip.verse}`;
		const previousEndWord = lastEndWordByVerse.get(verseKey) ?? -1;
		const nextStartWord = Math.max(clip.startWordIndex, previousEndWord + 1);

		if (nextStartWord > clip.endWordIndex) continue;
		lastEndWordByVerse.set(verseKey, Math.max(previousEndWord, clip.endWordIndex));

		const nextTranslationStartByEdition = new Map<string, number>();
		let shouldCloneClip = nextStartWord !== clip.startWordIndex;

		for (const [edition, translation] of Object.entries(clip.translations)) {
			if (!(translation instanceof VerseTranslation)) continue;

			const translationKey = `${verseKey}:${edition}`;
			const previousTranslationEnd = lastEndTranslationByVerseEdition.get(translationKey) ?? -1;
			const nextTranslationStart = Math.max(translation.startWordIndex, previousTranslationEnd + 1);
			nextTranslationStartByEdition.set(edition, nextTranslationStart);
			if (nextTranslationStart !== translation.startWordIndex) shouldCloneClip = true;
		}

		const clonedClip = shouldCloneClip ? clip.cloneWithTimes(clip.startTime, clip.endTime) : clip;
		const removedWords = nextStartWord - clip.startWordIndex;
		const keptWordCount = clip.endWordIndex - nextStartWord + 1;

		if (removedWords > 0) {
			clonedClip.startWordIndex = nextStartWord;
			clonedClip.text = trimTextWords(clonedClip.text, removedWords, keptWordCount);
			if (clonedClip.indopakText) {
				clonedClip.indopakText = trimTextWords(clonedClip.indopakText, removedWords, keptWordCount);
			}
			clonedClip.arabicInlineStyleRuns = trimInlineRunsAfterWordRemoval(
				clonedClip.arabicInlineStyleRuns ?? [],
				removedWords,
				keptWordCount
			);
		}

		for (const [edition, translation] of Object.entries(clonedClip.translations)) {
			if (!translation || typeof translation !== 'object') continue;
			if (!('text' in translation)) continue;

			if (translation instanceof VerseTranslation) {
				const translationKey = `${verseKey}:${edition}`;
				const nextTranslationStart =
					nextTranslationStartByEdition.get(edition) ?? translation.startWordIndex;
				const translationEnd = translation.endWordIndex;
				const removedTranslationWords = nextTranslationStart - translation.startWordIndex;
				const keptTranslationWordCount = translationEnd - nextTranslationStart + 1;

				lastEndTranslationByVerseEdition.set(
					translationKey,
					Math.max(lastEndTranslationByVerseEdition.get(translationKey) ?? -1, translationEnd)
				);

				if (keptTranslationWordCount <= 0) {
					translation.text = '';
					translation.inlineStyleRuns = [];
					translation.wbwRanges = [];
					continue;
				}

				if (removedTranslationWords > 0) {
					translation.startWordIndex = nextTranslationStart;
					translation.text = trimTextWords(
						translation.text,
						removedTranslationWords,
						keptTranslationWordCount
					);
					translation.inlineStyleRuns = trimInlineRunsAfterWordRemoval(
						translation.inlineStyleRuns ?? [],
						removedTranslationWords,
						keptTranslationWordCount
					);
				}

				if (removedWords > 0) {
					translation.wbwRanges = (translation.wbwRanges ?? [])
						.map((range) => ({
							...range,
							arabicWordIndex: range.arabicWordIndex - removedWords
						}))
						.filter((range) => range.arabicWordIndex >= 0 && range.arabicWordIndex < keptWordCount);
				}
			} else if (removedWords > 0) {
				translation.text = trimTextWords(translation.text, removedWords, keptWordCount);
			}
		}

		normalizedClips.push(clonedClip);
	}

	return normalizedClips;
}

/**
 * Retourne les segments arabes visibles selon la fusion.
 * @param {ClipWithTranslation | null} subtitle Sous-titre courant.
 * @param {VisualMergeGroup | null} mergedGroup Groupe fusion actif.
 * @param {(subtitle: ClipWithTranslation, keyPrefix: string) => OverlayTextSegment[]} getArabicOverlaySegments Générateur des segments arabes.
 * @returns {OverlayTextSegment[]} Segments à afficher.
 */
export function getVisibleArabicSegments(
	subtitle: ClipWithTranslation | null,
	mergedGroup: VisualMergeGroup | null,
	getArabicOverlaySegments: (
		subtitle: ClipWithTranslation,
		keyPrefix: string
	) => OverlayTextSegment[]
): OverlayTextSegment[] {
	if (!(subtitle instanceof ClipWithTranslation)) return [];

	if (!isVisualMergeTargetMerged(mergedGroup, 'arabic')) {
		return getArabicOverlaySegments(subtitle, `current-${subtitle.id}`);
	}

	return joinOverlaySegmentGroups(
		getMergedClipsWithoutWordOverlap(mergedGroup!.clips).map((clip) =>
			getArabicOverlaySegments(clip, `merge-${clip.id}`)
		),
		'merged-arabic'
	);
}

/**
 * Retourne les segments de traduction visibles selon la fusion.
 * @param {SubtitleClip | PredefinedSubtitleClip | null} subtitle Sous-titre courant.
 * @param {VisualMergeGroup | null} mergedGroup Groupe fusion actif.
 * @param {string} edition Édition de traduction.
 * @param {(edition: string, subtitle: SubtitleClip) => OverlayTextSegment[]} getTranslationOverlaySegments Générateur des segments de traduction.
 * @returns {OverlayTextSegment[]} Segments à afficher.
 */
export function getVisibleTranslationSegments(
	subtitle: SubtitleClip | PredefinedSubtitleClip | null,
	mergedGroup: VisualMergeGroup | null,
	edition: string,
	getTranslationOverlaySegments: (edition: string, subtitle: SubtitleClip) => OverlayTextSegment[]
): OverlayTextSegment[] {
	if (!isVisualMergeTargetMerged(mergedGroup, edition)) {
		if (subtitle instanceof PredefinedSubtitleClip) {
			const translation = subtitle.translations[edition];
			return translation
				? [createPlainOverlaySegment(`${edition}-${subtitle.id}`, translation.getText())]
				: [];
		}
		if (!(subtitle instanceof SubtitleClip)) return [];
		return getTranslationOverlaySegments(edition, subtitle);
	}

	if (!(subtitle instanceof SubtitleClip)) return [];

	const mergedClips = getMergedClipsWithoutWordOverlap(mergedGroup!.clips);
	if (hasSharedMergedTranslation(mergedClips, edition)) {
		return getTranslationOverlaySegments(edition, mergedClips[mergedClips.length - 1]);
	}

	const groups = mergedClips.map((clip) => getTranslationOverlaySegments(edition, clip));
	const hasCjkSegments = groups.some((segments) =>
		segments.some((segment) => hasCjkText(segment.text))
	);
	const output: OverlayTextSegment[] = [];
	for (let index = 0; index < groups.length; index++) {
		const segments = groups[index];
		if (index === 0) {
			output.push(...segments);
			continue;
		}

		const previousLastSegment = groups[index - 1].at(-1);
		// Si le sous-titre précédent se termine par un tiret, on n'ajoute pas d'espace (règle du pas d'espace après un `—` dans les trads)
		const separator = hasCjkSegments || previousLastSegment?.text.endsWith('—') ? '' : ' ';
		if (separator) {
			output.push(createPlainOverlaySegment(`merged-${edition}-separator-${index}`, separator));
			output.push(...segments);
		} else {
			appendSegmentsWithoutSeparator(output, segments);
		}
	}

	return output;
}

/**
 * Indique si tous les clips fusionnes partagent la meme traduction source.
 * @param {SubtitleClip[]} clips Clips du groupe fusionne.
 * @param {string} edition Edition de traduction.
 * @returns {boolean} `true` si une seule traduction doit etre rendue.
 */
export function hasSharedMergedTranslation(clips: SubtitleClip[], edition: string): boolean {
	if (clips.length <= 1) return false;
	const translation = clips[0].translations[edition];
	return !!translation && clips.every((clip) => clip.translations[edition] === translation);
}
