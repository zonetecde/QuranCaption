import {
	Clip,
	PredefinedSubtitleClip,
	SubtitleClip,
	type VisualMergeMode
} from '../../Clip.svelte.js';

export type VisualMergeSelection = {
	clips: SubtitleClip[];
	startIndex: number;
	endIndex: number;
};

export type VisualMergeGroup = {
	groupId: string;
	mode: VisualMergeMode;
	clips: SubtitleClip[];
	firstClip: SubtitleClip;
	lastClip: SubtitleClip;
	startTime: number;
	endTime: number;
};

/** Centralise les règles de lecture propres aux groupes de fusion visuelle. */
export class SubtitleVisualMergeService {
	/**
	 * Normalise une sélection selon l'ordre de la timeline et vérifie sa continuité.
	 * @param {Clip[]} trackClips Clips présents sur la piste.
	 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selection Sélection à contrôler.
	 * @returns {VisualMergeSelection | null} Sélection normalisée ou `null` lorsqu'elle est invalide.
	 */
	static getSelection(
		trackClips: Clip[],
		selection: Array<SubtitleClip | PredefinedSubtitleClip>
	): VisualMergeSelection | null {
		if (selection.length <= 1 || !selection.every((clip) => clip instanceof SubtitleClip)) {
			return null;
		}

		const clipsWithIndexes = selection
			.map((clip) => ({
				clip,
				index: trackClips.findIndex((trackClip) => trackClip.id === clip.id)
			}))
			.sort((left, right) => left.index - right.index);

		if (clipsWithIndexes.some(({ index }) => index === -1)) return null;
		if (!this.hasConsecutiveIndexes(clipsWithIndexes.map(({ index }) => index))) return null;

		return {
			clips: clipsWithIndexes.map(({ clip }) => clip),
			startIndex: clipsWithIndexes[0].index,
			endIndex: clipsWithIndexes[clipsWithIndexes.length - 1].index
		};
	}

	/**
	 * Vérifie qu'une suite de clips conserve une continuité logique de mots coraniques.
	 * @param {SubtitleClip[]} clips Clips triés dans l'ordre de la timeline.
	 * @returns {boolean} `true` lorsque la fusion arabe est autorisée.
	 */
	static canUseArabicMerge(clips: SubtitleClip[]): boolean {
		for (let index = 1; index < clips.length; index++) {
			if (!this.areArabicRangesContinuous(clips[index - 1], clips[index])) return false;
		}

		return true;
	}

	/**
	 * Reconstruit le groupe de fusion visuelle auquel appartient un clip.
	 * @param {Clip[]} trackClips Clips présents sur la piste.
	 * @param {number} clipId Identifiant du clip recherché.
	 * @returns {VisualMergeGroup | null} Groupe valide et contigu, ou `null`.
	 */
	static getGroupForClipId(trackClips: Clip[], clipId: number): VisualMergeGroup | null {
		const clip = trackClips.find((trackClip) => trackClip.id === clipId);
		if (!(clip instanceof SubtitleClip) || !clip.visualMergeGroupId || !clip.visualMergeMode) {
			return null;
		}

		const mergedClips = trackClips
			.map((trackClip, index) => ({ clip: trackClip, index }))
			.filter(
				(entry): entry is { clip: SubtitleClip; index: number } =>
					entry.clip instanceof SubtitleClip &&
					entry.clip.visualMergeGroupId === clip.visualMergeGroupId &&
					entry.clip.visualMergeMode === clip.visualMergeMode
			);

		if (mergedClips.length <= 1) return null;
		if (!this.hasConsecutiveIndexes(mergedClips.map(({ index }) => index))) return null;

		const firstClip = mergedClips[0].clip;
		const lastClip = mergedClips[mergedClips.length - 1].clip;
		return {
			groupId: clip.visualMergeGroupId,
			mode: clip.visualMergeMode,
			clips: mergedClips.map(({ clip: mergedClip }) => mergedClip),
			firstClip,
			lastClip,
			startTime: firstClip.startTime,
			endTime: lastClip.endTime
		};
	}

	/**
	 * Vérifie que chaque index suit immédiatement le précédent.
	 * @param {number[]} indexes Indexes triés à contrôler.
	 * @returns {boolean} `true` lorsque les indexes sont consécutifs.
	 */
	private static hasConsecutiveIndexes(indexes: number[]): boolean {
		for (let index = 1; index < indexes.length; index++) {
			if (indexes[index] !== indexes[index - 1] + 1) return false;
		}

		return true;
	}

	/**
	 * Vérifie la continuité entre deux plages de mots coraniques adjacentes.
	 * @param {SubtitleClip} previousClip Plage précédente.
	 * @param {SubtitleClip} currentClip Plage suivante.
	 * @returns {boolean} `true` lorsqu'aucun mot ni verset n'est sauté.
	 */
	private static areArabicRangesContinuous(
		previousClip: SubtitleClip,
		currentClip: SubtitleClip
	): boolean {
		if (previousClip.surah === currentClip.surah && previousClip.verse === currentClip.verse) {
			return currentClip.startWordIndex <= previousClip.endWordIndex + 1;
		}

		const startsNextVerse =
			previousClip.surah === currentClip.surah && currentClip.verse === previousClip.verse + 1;
		return startsNextVerse && previousClip.isLastWordsOfVerse && currentClip.startWordIndex === 0;
	}
}
