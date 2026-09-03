import { TrackType } from '../enums.js';
import {
	Clip,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip,
	type PredefinedSubtitleType
} from '../Clip.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import { resolveCurrentSurahFromClips } from '$lib/services/ExportCaptureTiming';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { SubtitleVisualMergeTrack } from './SubtitleVisualMergeTrack.svelte.js';

export class SubtitleTrack extends SubtitleVisualMergeTrack {
	/** Initialise la piste dédiée aux sous-titres. */
	constructor() {
		super(TrackType.Subtitle);
	}

	/**
	 * Retourne la sourate actuellement lue à la position du curseur (pour l'affiche du nom de la
	 * sourate sur la vidéo)
	 * @param {number} [time] Position à inspecter en millisecondes.
	 * @returns {number} Numéro de la sourate active.
	 */
	getCurrentSurah(time?: number): number {
		const cursorPos = time !== undefined ? time : globalState.getTimelineState.cursorPosition;

		return resolveCurrentSurahFromClips(this.clips, cursorPos);
	}

	/**
	 * Ajoute un clip de silence à la piste.
	 * @param {number} beforeClipOfId Si spécifié, ajoute le silence avant le clip avec cet ID.
	 * @returns {boolean} `true` si le silence a été ajouté, sinon `false`.
	 */
	addSilence(beforeClipOfId: number = -1): boolean {
		ProjectHistoryManager.begin('add silence');
		try {
			if (beforeClipOfId === -1) {
				const startTime = this.getDuration().ms + 1;
				const endTime =
					globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

				if (endTime < startTime) {
					toast.error(get(LL).editor.endTimeMustBeGreater());
					return false;
				}

				this.clips.push(new SilenceClip(startTime, endTime));

				return true;
			} else {
				// Trouve le clip avant lequel ajouter le silence
				for (let i = 0; i < this.clips.length; i++) {
					const element = this.clips[i];

					if (element.id === beforeClipOfId) {
						const previousClip = i > 0 ? this.clips[i - 1] : null;

						if (previousClip) {
							const startTime = previousClip.endTime + 1;
							const endTime = startTime + 500; // Durée de 500ms par défaut

							// Vérifie si le clip actuel fera moins de 100ms
							if (element.endTime - (endTime + 1) < 100) {
								toast.error(get(LL).editor.cannotAddSilenceTooShort());
								return false;
							}

							// Insert le clip silence avant le clip spécifié
							this.clips.splice(i, 0, new SilenceClip(startTime, endTime));

							// Change le startTime du clip spécifié pour éviter les chevauchements
							element.setStartTime(endTime + 1);
							return true;
						} else {
							// Ajoute le silence au début de la piste
							const startTime = 0;
							const endTime = 500; // Durée de 500ms par défaut
							if (element.endTime - (endTime + 1) < 100) {
								toast.error(get(LL).editor.cannotAddSilenceTooShort());
								return false;
							}
							this.clips.unshift(new SilenceClip(startTime, endTime));
							// Change le startTime du clip spécifié pour éviter les chevauchements
							element.setStartTime(endTime + 1);
							return true;
						}
					}
				}
			}

			return false;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Ajoute un sous-titre prédéfini jusqu'à la position courante du curseur.
	 * @param {PredefinedSubtitleType} type Type de sous-titre prédéfini à créer.
	 * @returns {boolean} `true` lorsque le clip a été ajouté.
	 */
	addPredefinedSubtitle(type: PredefinedSubtitleType): boolean {
		ProjectHistoryManager.begin('add predefined subtitle');
		try {
			const startTime = this.getDuration().ms + 1;
			const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

			if (endTime < startTime) {
				toast.error(get(LL).editor.endTimeMustBeGreater());
				return false;
			}

			this.clips.push(new PredefinedSubtitleClip(startTime, endTime, type));

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Renvoie le clip de sous-titre avant l'index spécifié.
	 * @param {number} i L'index du clip pour lequel on veut trouver le clip de sous-titre précédent.
	 * @param {boolean} allowPredefined Autorise les sous-titres prédéfinis dans la recherche.
	 * @returns {SubtitleClip | null} Clip précédent, ou `null` s'il n'existe pas.
	 */
	getSubtitleBefore(i: number, allowPredefined: boolean = false): SubtitleClip | null {
		if (i <= 0) {
			return null;
		}

		do {
			i--;
		} while (
			i >= 0 &&
			!(
				this.clips[i] instanceof SubtitleClip ||
				(allowPredefined && this.clips[i] instanceof PredefinedSubtitleClip)
			)
		);

		return this.clips[i] as SubtitleClip | null;
	}

	/**
	 * Renvoie le clip de sous-titre après l'index spécifié.
	 * @param {number} i L'index du clip pour lequel on veut trouver le clip de sous-titre suivant.
	 * @param {boolean} allowPredefined Autorise les sous-titres prédéfinis dans la recherche.
	 * @returns {SubtitleClip | null} Clip suivant, ou `null` s'il n'existe pas.
	 */
	getSubtitleAfter(i: number, allowPredefined: boolean = false): SubtitleClip | null {
		if (i < 0 || i >= this.clips.length - 1) {
			return null;
		}

		do {
			i++;
		} while (
			i < this.clips.length &&
			!(
				this.clips[i] instanceof SubtitleClip ||
				(allowPredefined && this.clips[i] instanceof PredefinedSubtitleClip)
			)
		);

		return this.clips[i] as SubtitleClip | null;
	}

	/**
	 * Retourne le sous-titre à afficher à la position courante.
	 * @param {boolean} anyType Autorise tout type de clip lorsqu'il vaut `true`.
	 * @returns {SubtitleClip | PredefinedSubtitleClip | Clip | null} Clip visible ou `null`.
	 */
	getCurrentSubtitleToDisplay(
		anyType: boolean = false
	): SubtitleClip | PredefinedSubtitleClip | null | Clip {
		const cursorPos = globalState.getTimelineState.cursorPosition;
		const clip = this.getCurrentClip(cursorPos);

		if (
			clip &&
			(anyType || clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip)
		) {
			return clip;
		}

		return null;
	}

	/**
	 * Décale les sous-titres de la piste d'un certain temps. Si `fromMs` est
	 * fourni, seuls les clips dont `startTime >= fromMs` sont décalés ; les
	 * autres restent à leur position. Si `fromMs` vaut 0 (par défaut), tous
	 * les clips sont décalés (comportement historique).
	 * @param {number} offsetMs Le décalage en millisecondes (positif ou négatif).
	 * @param {number} fromMs Optionnel — point de coupure. Seuls les clips démarrant
	 *               à `fromMs` ou après sont décalés.
	 * @returns {boolean} `true` si le décalage a été appliqué, sinon `false` (ex: temps négatif,
	 *          chevauchement avec la zone non-décalée).
	 */
	shiftAllClips(offsetMs: number, fromMs: number = 0): boolean {
		ProjectHistoryManager.begin('shift subtitles');
		try {
			if (!Number.isFinite(offsetMs) || !Number.isFinite(fromMs)) {
				toast.error(get(LL).editor.cannotShiftInvalidTiming());
				return false;
			}

			if (this.clips.length === 0) return true;

			const cutoffMs = Math.max(0, fromMs);
			const targets = this.clips.filter((clip) => clip.startTime >= cutoffMs);
			if (targets.length === 0) {
				toast(get(LL).editor.noSubtitlesToShift(), { icon: 'ℹ️' });
				return true;
			}

			// Vérification : est-ce que le décalage rendrait un temps négatif ?
			for (const clip of targets) {
				if (clip.startTime + offsetMs < 0) {
					toast.error(get(LL).editor.cannotShiftBeforeZero());
					return false;
				}
			}

			// Vérification : décalage arrière qui chevaucherait la zone non-décalée.
			// On autorise ce cas si le clip bloquant juste avant la coupure peut être
			// raccourci, ou supprimé s'il s'agit d'un silence.
			if (offsetMs < 0 && targets.length < this.clips.length) {
				let lastNonShiftedClip: Clip | null = null;
				let firstShiftedStart = Number.POSITIVE_INFINITY;

				for (const clip of this.clips) {
					if (clip.startTime >= cutoffMs) {
						firstShiftedStart = Math.min(firstShiftedStart, clip.startTime + offsetMs);
					} else {
						if (!lastNonShiftedClip || clip.endTime > lastNonShiftedClip.endTime) {
							lastNonShiftedClip = clip;
						}
					}
				}

				if (lastNonShiftedClip && firstShiftedStart <= lastNonShiftedClip.endTime) {
					if (lastNonShiftedClip instanceof SilenceClip) {
						this.clips.splice(this.clips.indexOf(lastNonShiftedClip), 1);
					} else {
						const newBlockingEndTime = firstShiftedStart - 1;
						const newBlockingDuration = newBlockingEndTime - lastNonShiftedClip.startTime;

						if (newBlockingDuration < 100) {
							toast.error(get(LL).editor.cannotShiftBackward());
							return false;
						}

						lastNonShiftedClip.setEndTime(newBlockingEndTime);
					}
				}
			}

			// Applique le décalage. Les clips ciblés bougent tous ensemble, donc
			// les chevauchements internes ne changent pas. clip.startTime/endTime
			// sont des $state, donc réactifs.
			for (const clip of targets) {
				clip.startTime += offsetMs;
				clip.endTime += offsetMs;
			}

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}

export type { VisualMergeGroup, VisualMergeSelection } from './SubtitleVisualMergeTrack.svelte.js';
