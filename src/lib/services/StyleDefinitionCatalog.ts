import type { Category, Style } from '$lib/classes/VideoStyle.svelte';

export type RawStyleDefinition = Partial<Style> & { id: string };
export type RawCategoryDefinition = Omit<Partial<Category>, 'styles'> & {
	id: string;
	styles?: RawStyleDefinition[];
};

/**
 * Charge et valide une liste de catégories de styles statiques.
 * @param {'global' | 'subtitle'} target Catalogue standard à charger.
 * @returns {Promise<RawCategoryDefinition[]>} Définitions de catégories valides.
 */
export async function loadStyleCategoryDefinitions(
	target: 'global' | 'subtitle'
): Promise<RawCategoryDefinition[]> {
	const path = target === 'global' ? './styles/globalStyles.json' : './styles/styles.json';
	const definitions = (await (await fetch(path)).json()) as unknown;
	if (!Array.isArray(definitions) || definitions.some((category) => !isStyleCategory(category))) {
		throw new Error(`Invalid style category catalog: ${path}`);
	}
	return definitions;
}

/**
 * Charge et valide la catégorie d'un contenu personnalisé.
 * @param {'text' | 'image'} type Type de contenu personnalisé.
 * @returns {Promise<RawCategoryDefinition>} Définition de catégorie valide.
 */
export async function loadCustomStyleCategoryDefinition(
	type: 'text' | 'image'
): Promise<RawCategoryDefinition> {
	const path = type === 'text' ? './styles/customText.json' : './styles/customImage.json';
	const definition = (await (await fetch(path)).json()) as unknown;
	if (!isStyleCategory(definition)) throw new Error(`Invalid custom style catalog: ${path}`);
	return definition;
}

/**
 * Charge et valide les styles utilisés par les valeurs composites.
 * @returns {Promise<RawStyleDefinition[]>} Définitions de styles composites valides.
 */
export async function loadCompositeStyleDefinitions(): Promise<RawStyleDefinition[]> {
	const path = './styles/compositeStyles.json';
	const definitions = (await (await fetch(path)).json()) as unknown;
	if (!Array.isArray(definitions) || definitions.some((style) => !isStyleDefinition(style))) {
		throw new Error(`Invalid composite style catalog: ${path}`);
	}
	return definitions;
}

/**
 * Vérifie la forme persistante minimale d'une catégorie de styles.
 * @param {unknown} value Valeur JSON à vérifier.
 * @returns {value is RawCategoryDefinition} `true` si la catégorie est exploitable.
 */
function isStyleCategory(value: unknown): value is RawCategoryDefinition {
	if (!value || typeof value !== 'object') return false;
	const category = value as { id?: unknown; styles?: unknown };
	return (
		typeof category.id === 'string' &&
		(category.styles === undefined ||
			(Array.isArray(category.styles) && category.styles.every(isStyleDefinition)))
	);
}

/**
 * Vérifie la forme persistante minimale d'un style.
 * @param {unknown} value Valeur JSON à vérifier.
 * @returns {value is RawStyleDefinition} `true` si le style possède un identifiant stable.
 */
function isStyleDefinition(value: unknown): value is RawStyleDefinition {
	return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
}
