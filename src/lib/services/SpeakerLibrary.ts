import { SubtitleClip } from '$lib/classes/Clip.svelte';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

export const UNASSIGNED_SPEAKER = 'Unassigned';

/**
 * Traduit les noms d'intervenant réservés sans modifier les valeurs enregistrées.
 * @param {string} speaker Nom de l'intervenant dans le projet.
 * @returns {string} Nom à afficher dans l'interface.
 */
export function getSpeakerDisplayName(speaker: string): string {
	if (speaker === UNASSIGNED_SPEAKER) return Reflect.get(get(LL).editor, 'unassignedSpeaker')();
	if (speaker === 'Unknown speaker') return Reflect.get(get(LL).editor, 'unknownSpeaker')();
	return speaker;
}

export type SpeakerRemovalChoice =
	| { action: 'cancel' }
	| { action: 'unassigned' }
	| { action: 'reassign'; replacement: string };

export type SpeakerRemovalOutcome = {
	removed: boolean;
	speaker: string;
	replacement: string | null;
	affectedSegments: number;
};

/**
 * Normalise un nom pour les comparaisons.
 * @param {string} value Nom à normaliser.
 * @returns {string} Clé insensible à la casse.
 */
function speakerKey(value: string): string {
	return value.trim().toLocaleLowerCase();
}

/**
 * Retourne les données des intervenants du projet.
 * @param {Project} project Projet propriétaire.
 * @returns {Project["projectEditorState"]["subtitlesEditor"]} État des intervenants.
 */
function getEditorState(project: Project) {
	return project.projectEditorState.subtitlesEditor;
}

/**
 * Liste les segments de transcription du projet.
 * @param {Project} project Projet propriétaire.
 * @returns {SubtitleClip[]} Segments de transcription.
 */
function getTranscriptClips(project: Project): SubtitleClip[] {
	return project.content.timeline
		.getFirstTrack(TrackType.Subtitle)
		.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip);
}

/**
 * Compare deux noms normalisés.
 * @param {string} first Premier nom.
 * @param {string} second Second nom.
 * @returns {boolean} Vrai pour le même intervenant.
 */
function isSameSpeaker(first: string, second: string): boolean {
	return speakerKey(first) === speakerKey(second);
}

/**
 * Liste les intervenants connus sans doublons.
 * @param {Project} project Projet consulté.
 * @returns {string[]} Noms présents dans le projet.
 */
export function getVisibleProjectSpeakers(project: Project): string[] {
	const editorState = getEditorState(project);
	const candidates = [
		project.detail.speaker,
		...editorState.additionalSpeakers,
		...getTranscriptClips(project).map((clip) => clip.speaker)
	];
	const seen = new Set<string>();

	return candidates.filter((candidate) => {
		const normalized = candidate.trim();
		const key = speakerKey(normalized);
		if (!normalized || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Ajoute un intervenant dans une opération annulable.
 * @param {Project} project Projet propriétaire.
 * @param {string} value Nom à ajouter.
 * @returns {string | null} Nom retenu, ou null si vide.
 */
export function addProjectSpeaker(project: Project, value: string): string | null {
	const normalized = value.trim();
	if (!normalized) return null;

	const existing = getVisibleProjectSpeakers(project).find((speaker) =>
		isSameSpeaker(speaker, normalized)
	);
	if (existing) return existing;

	ProjectHistoryManager.track(
		'add speaker',
		() => getEditorState(project).additionalSpeakers.push(normalized),
		project
	);
	return normalized;
}

export function canRemoveProjectSpeaker(value: string): boolean {
	const normalized = value.trim();
	return Boolean(normalized) && !isSameSpeaker(normalized, UNASSIGNED_SPEAKER);
}

/**
 * Compte les segments attribués à un intervenant.
 * @param {Project} project Projet consulté.
 * @param {string} value Nom recherché.
 * @returns {number} Nombre de segments.
 */
export function getSpeakerUsageCount(project: Project, value: string): number {
	return getTranscriptClips(project).filter((clip) => isSameSpeaker(clip.speaker, value)).length;
}

/**
 * Liste les intervenants pouvant remplacer le nom donné.
 * @param {Project} project Projet consulté.
 * @param {string} value Nom à remplacer.
 * @returns {string[]} Remplacements disponibles.
 */
export function getSpeakerReplacementOptions(project: Project, value: string): string[] {
	return getVisibleProjectSpeakers(project).filter(
		(speaker) => !isSameSpeaker(speaker, value) && !isSameSpeaker(speaker, UNASSIGNED_SPEAKER)
	);
}

/**
 * Indique si le nom correspond à l'intervenant principal du projet.
 * @param {Project} project Projet consulté.
 * @param {string} value Nom recherché.
 * @returns {boolean} Vrai pour l'intervenant principal.
 */
export function isProjectMainSpeaker(project: Project, value: string): boolean {
	return isSameSpeaker(project.detail.speaker, value);
}

/**
 * Ajoute le nom sans affectation si nécessaire.
 * @param {Project} project Projet propriétaire.
 * @returns {void}
 */
function ensureUnassignedSpeakerIsAvailable(project: Project): void {
	if (
		getVisibleProjectSpeakers(project).some((speaker) => isSameSpeaker(speaker, UNASSIGNED_SPEAKER))
	) {
		return;
	}
	getEditorState(project).additionalSpeakers.push(UNASSIGNED_SPEAKER);
}

/**
 * Supprime un intervenant et réaffecte ses segments dans une seule opération annulable.
 * @param {Project} project Projet propriétaire.
 * @param {string} value Intervenant à supprimer.
 * @param {string | null} replacement Remplacement choisi ou absence d'affectation.
 * @returns {string} Intervenant à sélectionner après la suppression.
 */
export function removeProjectSpeaker(
	project: Project,
	value: string,
	replacement: string | null
): string {
	const normalized = value.trim();
	if (!canRemoveProjectSpeaker(normalized)) return '';

	const editorState = getEditorState(project);
	const replacementName = replacement?.trim() || '';
	const affectedSegments = getSpeakerUsageCount(project, normalized);
	return ProjectHistoryManager.track(
		'remove speaker',
		() => {
			if (affectedSegments > 0) {
				for (const clip of getTranscriptClips(project)) {
					if (isSameSpeaker(clip.speaker, normalized)) {
						clip.speaker = replacementName || UNASSIGNED_SPEAKER;
					}
				}
			}

			editorState.additionalSpeakers = editorState.additionalSpeakers.filter(
				(speaker) => !isSameSpeaker(speaker, normalized)
			);

			if (isProjectMainSpeaker(project, normalized)) {
				project.detail.speaker =
					replacementName && !isSameSpeaker(replacementName, UNASSIGNED_SPEAKER)
						? replacementName
						: '';
			}

			let fallback = replacementName;
			if (!fallback) {
				fallback =
					getVisibleProjectSpeakers(project).find(
						(speaker) => !isSameSpeaker(speaker, normalized)
					) ?? '';
			}
			if (!fallback) {
				ensureUnassignedSpeakerIsAvailable(project);
				fallback = UNASSIGNED_SPEAKER;
			}

			if (isSameSpeaker(editorState.selectedSpeaker, normalized)) {
				editorState.selectedSpeaker = fallback;
			}

			return fallback;
		},
		project
	);
}

/**
 * Indique si un intervenant figure dans le projet.
 * @param {Project} project Projet consulté.
 * @param {string} value Nom recherché.
 * @returns {boolean} Présence du nom.
 */
export function isSpeakerVisible(project: Project, value: string): boolean {
	return getVisibleProjectSpeakers(project).some((speaker) => isSameSpeaker(speaker, value));
}
