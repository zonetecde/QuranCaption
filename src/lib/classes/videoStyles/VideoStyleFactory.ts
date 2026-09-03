import { Utilities } from '../misc/Utilities.js';
import {
	loadCustomStyleCategoryDefinition,
	loadStyleCategoryDefinitions
} from '$lib/services/StyleDefinitionCatalog.js';
import { Category } from './Category.svelte.js';
import { StylesData } from './StylesData.svelte.js';
import { getNonArabicSubtitleCategories } from './styleRuntime.js';

/** Construit les collections et catégories de styles par défaut. */
export class VideoStyleFactory {
	/**
	 * Construit les styles globaux et arabes d'un nouveau projet.
	 * @returns {Promise<StylesData[]>} Collections initialisées avec leurs composites.
	 */
	static async createDefaultCollections(): Promise<StylesData[]> {
		const globalStyles = new StylesData('global', await loadStyleCategoryDefinitions('global'));
		const arabicStyles = new StylesData('arabic', await loadStyleCategoryDefinitions('subtitle'));
		arabicStyles.setStyle('font-family', 'QPC2');
		arabicStyles.setStyle('line-height', 1.6);
		arabicStyles.setStyle('font-size', 90);
		arabicStyles.setStyle('vertical-position', -110);
		await globalStyles.loadCompositeStyles();
		return [globalStyles, arabicStyles];
	}

	/**
	 * Construit les styles par défaut d'une édition de traduction.
	 * @param {string} edition Identifiant de l'édition.
	 * @returns {Promise<StylesData>} Collection prête à être ajoutée.
	 */
	static async createTranslationStyles(edition: string): Promise<StylesData> {
		const definitions = getNonArabicSubtitleCategories(
			await loadStyleCategoryDefinitions('subtitle')
		);
		const styles = new StylesData(
			edition,
			definitions.map((category) => new Category(category))
		);
		styles.setStyle('font-family', 'Georgia');
		styles.setStyle('font-size', 60);
		styles.setStyle('vertical-position', 70);
		return styles;
	}

	/**
	 * Construit une catégorie personnalisée avec des identifiants uniques.
	 * @param {'text' | 'image'} type Nature de la catégorie.
	 * @returns {Promise<Category>} Catégorie prête à être ajoutée.
	 */
	static async createCustomCategory(type: 'text' | 'image'): Promise<Category> {
		const category = new Category(await loadCustomStyleCategoryDefinition(type));
		const suffix = Utilities.randomId();
		category.id += '-' + suffix;
		if (type === 'text') {
			category.getStyle('custom-text-composite')!.id += '-' + suffix;
			await category.loadCompositeStyle();
		}
		return category;
	}
}
