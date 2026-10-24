import type { Project } from '$lib/classes/Project';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import { globalState } from '$lib/runes/main.svelte';
import { mount, unmount } from 'svelte';
import SpeakerRemovalModal from './SpeakerRemovalModal.svelte';
import {
	canRemoveProjectSpeaker,
	getSpeakerUsageCount,
	getSpeakerReplacementOptions,
	isProjectMainSpeaker,
	removeProjectSpeaker,
	UNASSIGNED_SPEAKER,
	type SpeakerRemovalChoice,
	type SpeakerRemovalOutcome
} from '$lib/services/SpeakerLibrary';

/**
 * Affiche la confirmation de suppression sans introduire de dépendance DOM dans le service métier.
 * @param {Project} project Projet propriétaire.
 * @param {string} speakerName Intervenant choisi.
 * @param {number} usageCount Nombre de segments concernés.
 * @param {string[]} replacementOptions Intervenants de remplacement.
 * @returns {Promise<SpeakerRemovalChoice>} Décision de l'utilisateur.
 */
function openSpeakerRemovalModal(
	project: Project,
	speakerName: string,
	usageCount: number,
	replacementOptions: string[]
): Promise<SpeakerRemovalChoice> {
	return new Promise<SpeakerRemovalChoice>((resolve) => {
		const container = document.createElement('div');
		container.classList.add('modal-wrapper');
		document.body.appendChild(container);

		const modal = mount(SpeakerRemovalModal, {
			target: container,
			props: {
				speakerName,
				usageCount,
				replacementOptions,
				isProjectSpeaker: isProjectMainSpeaker(project, speakerName),
				resolve: (choice: SpeakerRemovalChoice) => {
					unmount(modal);
					container.remove();
					resolve(choice);
				}
			}
		});
	});
}

/**
 * Recueille la décision puis délègue la mutation au service des intervenants.
 * @param {Project} project Projet propriétaire.
 * @param {string} value Intervenant à supprimer.
 * @returns {Promise<SpeakerRemovalOutcome>} Résultat de la suppression.
 */
export async function requestProjectSpeakerRemoval(
	project: Project,
	value: string
): Promise<SpeakerRemovalOutcome> {
	const normalized = value.trim();
	if (!canRemoveProjectSpeaker(normalized) || globalState.currentProject !== project) {
		return {
			removed: false,
			speaker: normalized,
			replacement: null,
			affectedSegments: 0
		};
	}

	const affectedSegments = getSpeakerUsageCount(project, normalized);
	if (affectedSegments === 0) {
		const fallback = removeProjectSpeaker(project, normalized, null);
		AnalyticsService.track('speaker_removed', { affected_segments: 0, reassigned: false });
		globalState.updateVideoPreviewUI();
		return {
			removed: true,
			speaker: normalized,
			replacement: fallback || null,
			affectedSegments: 0
		};
	}

	const choice = await openSpeakerRemovalModal(
		project,
		normalized,
		affectedSegments,
		getSpeakerReplacementOptions(project, normalized)
	);
	if (choice.action === 'cancel' || globalState.currentProject !== project) {
		return {
			removed: false,
			speaker: normalized,
			replacement: null,
			affectedSegments
		};
	}

	const replacement =
		choice.action === 'unassigned' ? UNASSIGNED_SPEAKER : choice.replacement.trim();
	const fallback = removeProjectSpeaker(project, normalized, replacement);
	AnalyticsService.track('speaker_removed', {
		affected_segments: affectedSegments,
		reassigned: choice.action === 'reassign'
	});
	globalState.updateVideoPreviewUI();
	return {
		removed: true,
		speaker: normalized,
		replacement: fallback || replacement || null,
		affectedSegments
	};
}
