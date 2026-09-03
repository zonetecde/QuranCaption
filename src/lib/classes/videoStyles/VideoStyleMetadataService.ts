import { loadStyleCategoryDefinitions } from '$lib/services/StyleDefinitionCatalog.js';
import type { StylesData } from './StylesData.svelte.js';

/** Hydrate les métadonnées UI non persistées des styles. */
export class VideoStyleMetadataService {
	/**
	 * Recharge les métadonnées depuis les catalogues JSON.
	 * @param {StylesData[]} styles Collections à hydrater.
	 * @returns {Promise<void>} Promesse résolue après l'hydratation.
	 */
	static async hydrate(styles: StylesData[]): Promise<void> {
		const [globalDefaults, subtitleDefaults] = await Promise.all([
			loadStyleCategoryDefinitions('global'),
			loadStyleCategoryDefinitions('subtitle')
		]);
		for (const stylesData of styles) {
			const defaults = stylesData.target === 'global' ? globalDefaults : subtitleDefaults;
			for (const category of stylesData.categories) {
				category.setUiMetadata(defaults.find((candidate) => candidate.id === category.id)?.ui);
			}
		}
	}

	/**
	 * Recopie les métadonnées UI depuis un autre ensemble de styles.
	 * @param {StylesData[]} target Collections qui reçoivent les métadonnées.
	 * @param {StylesData[]} source Collections de référence.
	 * @returns {void}
	 */
	static copy(target: StylesData[], source: StylesData[]): void {
		for (const stylesData of target) {
			const sourceStyles = source.find((candidate) => candidate.target === stylesData.target);
			for (const category of stylesData.categories) {
				category.setUiMetadata(
					sourceStyles?.categories.find((candidate) => candidate.id === category.id)?.ui
				);
			}
		}
	}
}
