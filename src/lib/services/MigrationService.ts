import type { Project } from '$lib/classes';

export default class MigrationService {
	/**
	 * Recharge les métadonnées UI non persistées des styles à l'ouverture d'un projet.
	 * @param {Project} project - Projet chargé avant son affichage.
	 * @returns {Promise<void>} Promesse résolue une fois les métadonnées hydratées.
	 */
	static async hydrateStyleEditorUiMetadata(project: Project): Promise<void> {
		await project.content.videoStyle.hydrateStyleEditorUiMetadata();
	}
}
