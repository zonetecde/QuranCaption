import {
	ClipWithTranslation,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip
} from '../Clip.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import type { Verse } from '../Quran.js';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { scheduleWbwRealign } from '$lib/services/autoSegmentation/auto-realign.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import type { ProjectTranslation } from '../ProjectTranslation.svelte.js';
import { Track } from './Track.svelte.js';
import {
	SubtitleContentFactory,
	type SubtitleContentProperties
} from './subtitles/SubtitleContentFactory.js';
import { SubtitleSplitService } from './subtitles/SubtitleSplitService.js';

type SubtitleSplitOptions = {
	forceExactCursor?: boolean;
};

/** Piste capable d'éditer, créer et découper les sous-titres. */
export abstract class SubtitleSplitTrack extends Track {
	/**
	 * Dissocie un groupe visuel avant une opération de split.
	 * @param {string} groupId Identifiant du groupe à dissocier.
	 * @param {boolean} updatePreview Indique si la preview doit être rafraîchie.
	 * @returns {void}
	 */
	abstract unmergeVisualGroup(groupId: string, updatePreview?: boolean): void;

	/**
	 * Modifie un sous-titre existant ou transforme un clip spécial en sous-titre Quran.
	 * @param {SubtitleClip | PredefinedSubtitleClip | SilenceClip | ClipWithTranslation | null} subtitle Clip à modifier.
	 * @param {Verse} verse Nouveau verset du sous-titre.
	 * @param {number} firstWordIndex Index du premier mot.
	 * @param {number} lastWordIndex Index du dernier mot.
	 * @param {number} surah Numéro de la sourate.
	 * @returns {Promise<void>} Promesse résolue lorsque la modification est terminée.
	 */
	async editSubtitle(
		subtitle: SubtitleClip | PredefinedSubtitleClip | SilenceClip | ClipWithTranslation | null,
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	): Promise<void> {
		ProjectHistoryManager.begin('edit subtitle');
		try {
			if (subtitle instanceof SubtitleClip && subtitle.visualMergeGroupId) {
				this.unmergeVisualGroup(subtitle.visualMergeGroupId, false);
			}
			if (subtitle?.type !== 'Subtitle') {
				const newSubtitle = await SubtitleContentFactory.createClip(
					{
						startTime: subtitle!.startTime,
						endTime: subtitle!.endTime,
						surah,
						verse,
						firstWordIndex,
						lastWordIndex,
						associatedImageSource: subtitle instanceof ClipWithTranslation ? subtitle : undefined
					},
					this.getSubtitlesProperties.bind(this)
				);
				const clipIndex = this.clips.findIndex((clip) => clip.id === subtitle!.id);
				if (clipIndex !== -1) this.clips[clipIndex] = newSubtitle;
				subtitle = newSubtitle;
			} else if (subtitle instanceof SubtitleClip) {
				subtitle.verse = verse.id;
				subtitle.surah = surah;
				await SubtitleContentFactory.hydrateClip(
					subtitle,
					verse,
					firstWordIndex,
					lastWordIndex,
					this.getSubtitlesProperties.bind(this)
				);
			}
			if (subtitle instanceof SubtitleClip) {
				subtitle.markAsManualEdit();
				scheduleWbwRealign([subtitle], { reason: 'text' });
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Scinde un sous-titre à la position du curseur en conservant ses métadonnées.
	 * @param {number} clipId Identifiant du clip à scinder.
	 * @param {SubtitleSplitOptions} options Options qui contrôlent la scission.
	 * @returns {Promise<boolean>} `true` lorsque le sous-titre a été scindé.
	 */
	async splitSubtitle(clipId: number, options: SubtitleSplitOptions = {}): Promise<boolean> {
		ProjectHistoryManager.begin('split subtitle');
		try {
			const clipIndex = this.clips.findIndex((clip) => clip.id === clipId);
			if (clipIndex === -1) return false;
			const clip = this.clips[clipIndex];
			if (
				!(
					clip instanceof SubtitleClip ||
					clip instanceof PredefinedSubtitleClip ||
					clip instanceof SilenceClip
				)
			) {
				return false;
			}
			const splitTime = globalState.getTimelineState.cursorPosition;
			if (splitTime <= clip.startTime || splitTime >= clip.endTime) {
				toast.error(get(LL).editor.cursorMustBeInsideSubtitle());
				return false;
			}
			if (splitTime - clip.startTime < 100 || clip.endTime - splitTime < 100) {
				toast.error(get(LL).editor.clipsTooShort());
				return false;
			}
			if (clip instanceof SubtitleClip && clip.visualMergeGroupId) {
				this.unmergeVisualGroup(clip.visualMergeGroupId, false);
			}
			if (clip instanceof SubtitleClip) {
				const candidate = options.forceExactCursor
					? null
					: SubtitleSplitService.getNearestWordBoundarySplitCandidate(clip, splitTime);
				const exactWordIndex = SubtitleSplitService.getExactCursorSplitWordIndex(clip, splitTime);
				if (candidate) {
					if (
						candidate.splitTimeMs - clip.startTime < 100 ||
						clip.endTime - candidate.splitTimeMs < 100
					) {
						toast.error(get(LL).editor.clipsTooShort());
						return false;
					}
					return SubtitleSplitService.splitAtWordBoundary({
						clips: this.clips,
						clipIndex,
						clip,
						splitTimeMs: candidate.splitTimeMs,
						leftEndWordIndex: candidate.leftEndWordIndex,
						resolveProperties: this.getSubtitlesProperties.bind(this)
					});
				}
				if (exactWordIndex !== null) {
					return SubtitleSplitService.splitAtWordBoundary({
						clips: this.clips,
						clipIndex,
						clip,
						splitTimeMs: splitTime,
						leftEndWordIndex: exactWordIndex,
						resolveProperties: this.getSubtitlesProperties.bind(this)
					});
				}
			}
			const originalEndTime = clip.endTime;
			clip.setEndTime(splitTime);
			const newClip = SubtitleSplitService.cloneRightClip(clip, splitTime, originalEndTime);
			if (clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) {
				clip.markAsManualEdit();
			}
			if (newClip instanceof SubtitleClip || newClip instanceof PredefinedSubtitleClip) {
				newClip.markAsManualEdit();
			}
			this.clips.splice(clipIndex + 1, 0, newClip);
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Ajoute à la fin de la piste un sous-titre construit depuis une plage de verset.
	 * @param {Verse} verse Verset source du texte et des traductions.
	 * @param {number} firstWordIndex Index du premier mot inclus.
	 * @param {number} lastWordIndex Index du dernier mot inclus.
	 * @param {number} surah Numéro de la sourate du verset.
	 * @returns {Promise<boolean>} `true` lorsque le sous-titre a été ajouté.
	 */
	async addSubtitle(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	): Promise<boolean> {
		ProjectHistoryManager.begin('add subtitle');
		try {
			const startTime = this.getDuration().ms + 1;
			const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;
			if (endTime < startTime) {
				toast.error(get(LL).editor.endTimeMustBeGreater());
				return false;
			}
			this.clips.push(
				await SubtitleContentFactory.createClip(
					{ startTime, endTime, surah, verse, firstWordIndex, lastWordIndex },
					this.getSubtitlesProperties.bind(this)
				)
			);
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Extrait les propriétés dérivées d'une plage de mots.
	 * @param {Verse} verse Verset à analyser.
	 * @param {number} firstWordIndex Premier mot de la plage.
	 * @param {number} lastWordIndex Dernier mot de la plage.
	 * @param {number} surah Numéro de la sourate.
	 * @param {ProjectTranslation | null} projectTranslation Traductions du projet à interroger.
	 * @returns {Promise<SubtitleContentProperties>} Propriétés calculées du sous-titre.
	 */
	async getSubtitlesProperties(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number,
		projectTranslation: ProjectTranslation | null = globalState.currentProject?.content
			.projectTranslation ?? null
	): Promise<SubtitleContentProperties> {
		return SubtitleContentFactory.getProperties(
			verse,
			firstWordIndex,
			lastWordIndex,
			surah,
			projectTranslation
		);
	}
}
