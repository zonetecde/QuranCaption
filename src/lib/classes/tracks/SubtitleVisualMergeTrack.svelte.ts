import {
	ClipWithTranslation,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip,
	canonicalizePredefinedSubtitleType,
	type VisualMergeMode
} from '../Clip.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import {
	SubtitleVisualMergeService,
	type VisualMergeGroup,
	type VisualMergeSelection
} from './subtitles/SubtitleVisualMergeService.js';
import { SubtitleSplitTrack } from './SubtitleSplitTrack.svelte.js';

export type {
	VisualMergeGroup,
	VisualMergeSelection
} from './subtitles/SubtitleVisualMergeService.js';

export abstract class SubtitleVisualMergeTrack extends SubtitleSplitTrack {
	/**
	 * Indique si la timeline contient au moins un sous-titre avec des timestamps mot a mot.
	 * @returns {boolean} `true` si au moins un `SubtitleClip` porte des mots alignes.
	 */
	hasWordByWordTimestamps(): boolean {
		return this.clips.some(
			(clip) => clip instanceof SubtitleClip && (clip.alignmentMetadata?.words.length ?? 0) > 0
		);
	}

	/**
	 * Supprime un clip de sous-titre et retire d'abord son merge visuel si necessaire.
	 * @param {number} id L'identifiant du clip a supprimer.
	 * @param {boolean} makeNextClipStartAtThisClipStartTime Indique si le clip suivant doit reprendre son start.
	 * @returns {void}
	 */
	override removeClip(id: number, makeNextClipStartAtThisClipStartTime: boolean = false): void {
		ProjectHistoryManager.begin('remove subtitle clip');
		try {
			const clipToRemove = this.clips.find((clip) => clip.id === id);
			if (clipToRemove instanceof SubtitleClip && clipToRemove.visualMergeGroupId) {
				this.unmergeVisualGroup(clipToRemove.visualMergeGroupId, false);
			}

			super.removeClip(id, makeNextClipStartAtThisClipStartTime);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Verifie si une selection peut etre mergee visuellement.
	 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selection Selection courante.
	 * @returns {VisualMergeSelection | null} Les clips tries si la selection est eligible, sinon `null`.
	 */
	getVisualMergeSelection(
		selection: Array<SubtitleClip | PredefinedSubtitleClip>
	): VisualMergeSelection | null {
		return SubtitleVisualMergeService.getSelection(this.clips, selection);
	}

	/**
	 * Verifie si une selection consecutive suit une continuite logique de mots Quran.
	 * Les chevauchements sont autorises, mais aucun trou n'est accepte.
	 *
	 * @param {SubtitleClip[]} clips Clips Quran consecutifs tries par timeline.
	 * @returns {boolean} `true` si la chaine arabe est continue.
	 */
	canUseArabicVisualMerge(clips: SubtitleClip[]): boolean {
		return SubtitleVisualMergeService.canUseArabicMerge(clips);
	}

	/**
	 * Retourne le groupe de merge visuel actif pour un clip donne.
	 * @param {number} clipId L'identifiant du clip courant.
	 * @returns {VisualMergeGroup | null} Le groupe valide ou `null`.
	 */
	getVisualMergeGroupForClipId(clipId: number): VisualMergeGroup | null {
		return SubtitleVisualMergeService.getGroupForClipId(this.clips, clipId);
	}

	/**
	 * Applique un merge visuel a une selection de sous-titres Quran consecutifs.
	 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selection Selection a merger.
	 * @param {VisualMergeMode} mode Mode de merge a appliquer.
	 * @returns {boolean} `true` si le merge a ete applique.
	 */
	applyVisualMerge(
		selection: Array<SubtitleClip | PredefinedSubtitleClip>,
		mode: VisualMergeMode
	): boolean {
		ProjectHistoryManager.begin('apply visual merge');
		try {
			const mergeSelection = this.getVisualMergeSelection(selection);
			if (!mergeSelection) return false;
			if (!this.canUseArabicVisualMerge(mergeSelection.clips)) {
				return false;
			}

			const touchedGroupIds = new Set(
				mergeSelection.clips
					.map((clip) => clip.visualMergeGroupId)
					.filter((groupId): groupId is string => !!groupId)
			);

			for (const groupId of touchedGroupIds) {
				this.unmergeVisualGroup(groupId, false);
			}

			const groupId = `visual-merge-${Date.now()}-${mergeSelection.clips[0].id}`;
			for (const clip of mergeSelection.clips) {
				clip.setVisualMerge(groupId, mode);
			}

			if (globalState.currentProject) {
				const selectedSubtitleIds = new Set(
					globalState.getStylesState.selectedSubtitles.map((subtitle) => subtitle.id)
				);
				if (mergeSelection.clips.some((clip) => selectedSubtitleIds.has(clip.id))) {
					globalState.getStylesState.selectedSubtitles =
						globalState.getStylesState.normalizeSubtitleSelection(
							globalState.getStylesState.selectedSubtitles
						);
				}
			}

			globalState.updateVideoPreviewUI();
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Retire le merge visuel de tout un groupe.
	 * @param {string} groupId Identifiant du groupe a casser.
	 * @param {boolean} updatePreview Indique s'il faut rafraichir la preview ensuite.
	 * @returns {void}
	 */
	unmergeVisualGroup(groupId: string, updatePreview: boolean = true): void {
		ProjectHistoryManager.begin('unmerge visual group');
		try {
			for (const clip of this.clips) {
				if (clip instanceof SubtitleClip && clip.visualMergeGroupId === groupId) {
					clip.clearVisualMerge();
				}
			}

			if (updatePreview) {
				globalState.updateVideoPreviewUI();
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Coupe un groupe de merge visuel entre deux sous-titres adjacents.
	 * @param {SubtitleClip} leftClip Clip à gauche de la coupure.
	 * @param {SubtitleClip} rightClip Clip à droite de la coupure.
	 * @returns {boolean} `true` si le groupe a été coupé.
	 */
	splitVisualMergeBetween(leftClip: SubtitleClip, rightClip: SubtitleClip): boolean {
		if (
			!leftClip.visualMergeGroupId ||
			leftClip.visualMergeGroupId !== rightClip.visualMergeGroupId ||
			leftClip.visualMergeMode !== rightClip.visualMergeMode ||
			!leftClip.visualMergeMode
		) {
			return false;
		}

		const mergeGroup = this.getVisualMergeGroupForClipId(leftClip.id);
		if (!mergeGroup || mergeGroup.groupId !== leftClip.visualMergeGroupId) return false;

		const leftIndex = mergeGroup.clips.findIndex((clip) => clip.id === leftClip.id);
		if (leftIndex === -1 || mergeGroup.clips[leftIndex + 1]?.id !== rightClip.id) return false;

		const mode = leftClip.visualMergeMode;
		const leftSide = mergeGroup.clips.slice(0, leftIndex + 1);
		const rightSide = mergeGroup.clips.slice(leftIndex + 1);

		for (const clip of mergeGroup.clips) {
			clip.clearVisualMerge();
		}

		for (const side of [leftSide, rightSide]) {
			if (side.length <= 1) continue;
			const groupId = `visual-merge-${Date.now()}-${side[0].id}`;
			for (const clip of side) {
				clip.setVisualMerge(groupId, mode);
			}
		}

		globalState.updateVideoPreviewUI();
		return true;
	}

	/**
	 * Modifie un sous-titre existant pour le transformer en un sous-titre pré-défini (Silence, Istiadhah, Basmala).
	 * @param {SubtitleClip | PredefinedSubtitleClip | SilenceClip} subtitle Le sous-titre à modifier.
	 * @param {'Silence' | 'Basmala' | "Isti'adha" | 'Amin' | 'Takbir' | 'Tahmeed' | 'Tasleem' | 'Sadaqa'} presetChoice Le type de sous-titre pré-défini à appliquer.
	 * @returns {void}
	 */
	editSubtitleToSpecial(
		subtitle: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
		presetChoice:
			| 'Silence'
			| 'Basmala'
			| "Isti'adha"
			| 'Amin'
			| 'Takbir'
			| 'Tahmeed'
			| 'Tasleem'
			| 'Sadaqa'
	) {
		let newSubtitleClip: SilenceClip | PredefinedSubtitleClip | undefined = undefined;

		if (subtitle instanceof SubtitleClip && subtitle.visualMergeGroupId) {
			this.unmergeVisualGroup(subtitle.visualMergeGroupId, false);
		}

		if (presetChoice === 'Silence') {
			newSubtitleClip = new SilenceClip(subtitle.startTime, subtitle.endTime);
		} else if (presetChoice === 'Basmala') {
			newSubtitleClip = new PredefinedSubtitleClip(subtitle.startTime, subtitle.endTime, 'Basmala');
		} else {
			newSubtitleClip = new PredefinedSubtitleClip(
				subtitle.startTime,
				subtitle.endTime,
				canonicalizePredefinedSubtitleType(presetChoice)
			);
		}

		// Modiife le clip existant ou le remplace par le nouveau clip pré-défini
		if (newSubtitleClip) {
			if (
				newSubtitleClip instanceof ClipWithTranslation &&
				subtitle instanceof ClipWithTranslation
			) {
				newSubtitleClip.associatedImagePath = subtitle.associatedImagePath;
			}

			const clipIndex = this.clips.findIndex((clip) => clip.id === subtitle.id);
			if (clipIndex !== -1) {
				this.clips[clipIndex] = newSubtitleClip;
			}
		}
	}
}
