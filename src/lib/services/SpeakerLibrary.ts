import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

export const UNASSIGNED_SPEAKER = 'Unassigned';

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

function speakerKey(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function getEditorState() {
	return globalState.getSubtitlesEditorState;
}

function getTranscriptClips(): SubtitleClip[] {
	return globalState.getSubtitleTrack.clips.filter(
		(clip): clip is SubtitleClip => clip instanceof SubtitleClip
	);
}

function isSameSpeaker(first: string, second: string): boolean {
	return speakerKey(first) === speakerKey(second);
}

export function getVisibleProjectSpeakers(): string[] {
	const editorState = getEditorState();
	const candidates = [
		globalState.currentProject?.detail.speaker ?? '',
		...editorState.additionalSpeakers,
		...getTranscriptClips().map((clip) => clip.speaker)
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

export function addProjectSpeaker(value: string): string | null {
	const normalized = value.trim();
	if (!normalized) return null;

	const existing = getVisibleProjectSpeakers().find((speaker) =>
		isSameSpeaker(speaker, normalized)
	);
	if (existing) return existing;

	ProjectHistoryManager.track('add speaker', () =>
		getEditorState().additionalSpeakers.push(normalized)
	);
	return normalized;
}

export function canRemoveProjectSpeaker(value: string): boolean {
	const normalized = value.trim();
	return Boolean(normalized) && !isSameSpeaker(normalized, UNASSIGNED_SPEAKER);
}

export function getSpeakerUsageCount(value: string): number {
	return getTranscriptClips().filter((clip) => isSameSpeaker(clip.speaker, value)).length;
}

export function getSpeakerReplacementOptions(value: string): string[] {
	return getVisibleProjectSpeakers().filter(
		(speaker) => !isSameSpeaker(speaker, value) && !isSameSpeaker(speaker, UNASSIGNED_SPEAKER)
	);
}

/**
 * Indique si le nom correspond à l'intervenant principal du projet.
 * @param {string} value Nom recherché.
 * @returns {boolean} Vrai pour l'intervenant principal.
 */
export function isProjectMainSpeaker(value: string): boolean {
	return isSameSpeaker(globalState.currentProject?.detail.speaker ?? '', value);
}

function ensureUnassignedSpeakerIsAvailable(): void {
	if (getVisibleProjectSpeakers().some((speaker) => isSameSpeaker(speaker, UNASSIGNED_SPEAKER))) {
		return;
	}
	getEditorState().additionalSpeakers.push(UNASSIGNED_SPEAKER);
}

/**
 * Supprime un intervenant et réaffecte ses segments dans une seule opération annulable.
 * @param {string} value Intervenant à supprimer.
 * @param {string | null} replacement Remplacement choisi ou absence d'affectation.
 * @returns {string} Intervenant à sélectionner après la suppression.
 */
export function removeProjectSpeaker(value: string, replacement: string | null): string {
	const normalized = value.trim();
	if (!canRemoveProjectSpeaker(normalized)) return '';

	const editorState = getEditorState();
	const replacementName = replacement?.trim() || '';
	const affectedSegments = getSpeakerUsageCount(normalized);
	ProjectHistoryManager.begin('remove speaker');
	try {
		if (affectedSegments > 0) {
			for (const clip of getTranscriptClips()) {
				if (isSameSpeaker(clip.speaker, normalized)) {
					clip.speaker = replacementName || UNASSIGNED_SPEAKER;
				}
			}
		}

		editorState.additionalSpeakers = editorState.additionalSpeakers.filter(
			(speaker) => !isSameSpeaker(speaker, normalized)
		);

		if (isProjectMainSpeaker(normalized) && globalState.currentProject) {
			globalState.currentProject.detail.speaker =
				replacementName && !isSameSpeaker(replacementName, UNASSIGNED_SPEAKER)
					? replacementName
					: '';
		}

		let fallback = replacementName;
		if (!fallback) {
			fallback =
				getVisibleProjectSpeakers().find((speaker) => !isSameSpeaker(speaker, normalized)) ?? '';
		}
		if (!fallback) {
			ensureUnassignedSpeakerIsAvailable();
			fallback = UNASSIGNED_SPEAKER;
		}

		if (isSameSpeaker(editorState.selectedSpeaker, normalized)) {
			editorState.selectedSpeaker = fallback;
		}

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		return fallback;
	} finally {
		ProjectHistoryManager.commit();
	}
}

export function isSpeakerVisible(value: string): boolean {
	return getVisibleProjectSpeakers().some((speaker) => isSameSpeaker(speaker, value));
}
