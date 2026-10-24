import type { Project } from '$lib/classes';

export default class MigrationService {
	/**
	 * Retire les anciennes affectations multi-intervenants des sous-titres et de leur éditeur.
	 * @param {Record<string, unknown>} data Sous-titre, état d'édition ou résultat vocal sérialisé.
	 * @returns {Record<string, unknown>} Copie sans affectation, conservant les textes et timings.
	 */
	static migrateSingleSpeakerData(data: Record<string, unknown>): Record<string, unknown> {
		const migrated = { ...data };
		for (const key of ['speaker', 'speakers', 'selectedSpeaker', 'additionalSpeakers'])
			delete migrated[key];
		for (const key of ['rawTranscription', 'segments', 'words']) {
			const value = migrated[key];
			if (Array.isArray(value)) {
				migrated[key] = value.map((item) =>
					item && typeof item === 'object' ? MigrationService.migrateSingleSpeakerData(item) : item
				);
			} else if (value && typeof value === 'object') {
				migrated[key] = MigrationService.migrateSingleSpeakerData(value as Record<string, unknown>);
			}
		}
		return migrated;
	}

	/**
	 * Convertit les anciens champs et identifiants d'intervenants avant désérialisation.
	 * @param {Record<string, unknown>} data Données de projet, de styles ou de paramètres.
	 * @returns {Record<string, unknown>} Copie compatible avec les noms speaker, sans altérer les textes libres.
	 */
	static migrateSpeakerData(data: Record<string, unknown>): Record<string, unknown> {
		return MigrationService.migrateSpeakerValue(data) as Record<string, unknown>;
	}

	/**
	 * Renomme les clés historiques et les valeurs qui sont des identifiants de styles.
	 * @param {unknown} value Valeur sérialisée.
	 * @param {string} [property] Champ portant la valeur.
	 * @returns {unknown} Valeur normalisée, avec priorité aux clés déjà migrées.
	 */
	private static migrateSpeakerValue(value: unknown, property = ''): unknown {
		if (Array.isArray(value)) {
			return value.map((item) => MigrationService.migrateSpeakerValue(item, property));
		}
		if (value && typeof value === 'object') {
			const data = value as Record<string, unknown>;
			const migrated: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(data)) {
				const nextKey = key.replaceAll('reciter', 'speaker').replaceAll('Reciter', 'Speaker');
				if (nextKey !== key && Object.hasOwn(data, nextKey)) continue;
				migrated[nextKey] =
					key === 'value' && data.id === 'font-family' && item === 'Reciters'
						? 'Speakers'
						: MigrationService.migrateSpeakerValue(
								item,
								property === 'activePanelCategoryIds' ? 'id' : key
							);
			}
			return migrated;
		}
		if (typeof value === 'string') {
			if (property === 'font-family' && value === 'Reciters') return 'Speakers';
			if (
				['id', 'valueType', 'scrollAndHighlight', 'headerStyle', 'styleIds', 'css'].includes(
					property
				)
			) {
				return value.replaceAll('reciter', 'speaker').replaceAll('Reciters', 'Speakers');
			}
		}
		return value;
	}

	/**
	 * Recharge les métadonnées UI non persistées des styles à l'ouverture d'un projet.
	 * @param {Project} project - Projet chargé avant son affichage.
	 * @returns {Promise<void>} Promesse résolue une fois les métadonnées hydratées.
	 */
	static async hydrateStyleEditorUiMetadata(project: Project): Promise<void> {
		await project.content.videoStyle.hydrateStyleEditorUiMetadata();
	}
}
