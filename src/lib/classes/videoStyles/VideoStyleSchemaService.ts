import type { ProjectContent } from '../ProjectContent.svelte.js';
import { ensureCustomStyleSchema } from '$lib/services/ProjectStyleContentService';
import {
	loadCompositeStyleDefinitions,
	loadCustomStyleCategoryDefinition,
	loadStyleCategoryDefinitions,
	type RawCategoryDefinition
} from '$lib/services/StyleDefinitionCatalog';
import { getTimedOverlayRangesFromStyles } from '$lib/services/TimedOverlayRanges';
import { Category } from './Category.svelte.js';
import { Style } from './Style.svelte.js';
import { StylesData } from './StylesData.svelte.js';
import { getNonArabicSubtitleCategories } from './styleRuntime.js';

/** Maintient les styles persistés compatibles avec le schéma JSON courant. */
export class VideoStyleSchemaService {
	/**
	 * Ajoute les styles manquants sans écraser les valeurs d'un projet existant.
	 * @param {StylesData[]} styles Collections de styles à migrer.
	 * @param {ProjectContent | undefined} projectContent Contenu dont les styles personnalisés doivent être migrés.
	 * @returns {Promise<boolean>} `true` lorsqu'au moins une donnée a changé.
	 */
	static async ensureUpToDate(
		styles: StylesData[],
		projectContent?: ProjectContent
	): Promise<boolean> {
		let hasChanges = false;
		const arabicStyles = styles.find((stylesData) => stylesData.target === 'arabic');
		const hadRiwayah = Boolean(arabicStyles?.findStyle('riwayah'));
		const legacyMushaf = arabicStyles?.findStyle('mushaf-style')?.value;

		const globalDefaults = await loadStyleCategoryDefinitions('global');
		hasChanges = this.mergeMissingStylesForTarget(styles, 'global', globalDefaults) || hasChanges;
		const subtitleDefaults = await loadStyleCategoryDefinitions('subtitle');
		for (const stylesData of styles) {
			if (stylesData.target === 'global') continue;
			const defaults =
				stylesData.target === 'arabic'
					? subtitleDefaults
					: getNonArabicSubtitleCategories(subtitleDefaults);
			hasChanges =
				this.mergeMissingStylesForTarget(styles, stylesData.target, defaults) || hasChanges;
		}

		if (!hadRiwayah && legacyMushaf === 'Warsh' && arabicStyles) {
			arabicStyles.setStyle('riwayah', 'Warsh');
			arabicStyles.setStyle('mushaf-style', 'Uthmani');
			arabicStyles.setStyle('font-family', 'warsh10');
			hasChanges = true;
		}

		if (!projectContent) return hasChanges;
		const customTextDefaults = await loadCustomStyleCategoryDefinition('text');
		const compositeDefaults = await loadCompositeStyleDefinitions();
		return (
			ensureCustomStyleSchema(
				projectContent,
				customTextDefaults,
				compositeDefaults,
				(definition) => new Style(definition)
			) || hasChanges
		);
	}

	/**
	 * Fusionne les catégories et styles par défaut absents d'une cible.
	 * @param {StylesData[]} styles Collections de styles à modifier.
	 * @param {string} target Identifiant de la cible à compléter.
	 * @param {RawCategoryDefinition[]} defaultCategories Définitions de référence.
	 * @returns {boolean} `true` lorsqu'au moins une valeur a été ajoutée ou actualisée.
	 */
	static mergeMissingStylesForTarget(
		styles: StylesData[],
		target: string,
		defaultCategories: RawCategoryDefinition[]
	): boolean {
		const targetStyles = styles.find((candidate) => candidate.target === target);
		if (!targetStyles) {
			styles.push(
				new StylesData(
					target,
					defaultCategories.map((category) => new Category(category))
				)
			);
			return true;
		}

		let hasChanges = false;
		for (const defaultCategory of defaultCategories) {
			const targetCategory = targetStyles.categories.find(
				(category) => category.id === defaultCategory.id
			);
			if (!targetCategory) {
				targetStyles.categories.push(new Category(defaultCategory));
				hasChanges = true;
				continue;
			}
			targetCategory.setUiMetadata(defaultCategory.ui);
			hasChanges = this.mergeMissingStyles(targetCategory, defaultCategory) || hasChanges;
		}
		return hasChanges;
	}

	/**
	 * Complète une catégorie existante et rafraîchit les options de ses listes.
	 * @param {Category} targetCategory Catégorie persistée à compléter.
	 * @param {RawCategoryDefinition} defaultCategory Définition de référence.
	 * @returns {boolean} `true` lorsqu'une valeur a changé.
	 */
	private static mergeMissingStyles(
		targetCategory: Category,
		defaultCategory: RawCategoryDefinition
	): boolean {
		let hasChanges = false;
		for (const defaultStyle of defaultCategory.styles || []) {
			const existingStyle = targetCategory.styles.find((style) => style.id === defaultStyle.id);
			if (!existingStyle) {
				const migratedRanges = defaultStyle.id.endsWith('time-ranges')
					? getTimedOverlayRangesFromStyles(targetCategory.styles)
					: [];
				targetCategory.styles.push(
					new Style({
						...defaultStyle,
						value: migratedRanges.length ? migratedRanges : defaultStyle.value
					})
				);
				hasChanges = true;
				continue;
			}
			if (
				defaultStyle.valueType === 'select' &&
				Array.isArray(defaultStyle.options) &&
				Array.isArray(existingStyle.options) &&
				(existingStyle.options.length !== defaultStyle.options.length ||
					existingStyle.options.some((option, index) => option !== defaultStyle.options![index]))
			) {
				existingStyle.options = [...defaultStyle.options];
				hasChanges = true;
			}
		}
		return hasChanges;
	}
}
