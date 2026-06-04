import type { TranslationFunctions } from './i18n-types';

/**
 * Résout l'identifiant de style en retirant un éventuel suffixe aléatoire
 * ajouté aux catégories custom-text / custom-image pour éviter les collisions.
 * @param id Identifiant brut du style ou de la catégorie.
 * @returns L'identifiant de base (sans suffixe aléatoire) si trouvé dans les traductions,
 *          sinon l'identifiant d'origine.
 */
function resolveStyleId(id: string, LL: TranslationFunctions): string {
	const dict = LL.editor.styleName as unknown as Record<string, unknown>;
	if (dict[id] !== undefined) return id;

	// Retire un suffixe de type "-xxxxxx" (ID aléatoire ajouté aux catégories custom)
	const baseId = id.replace(/-[a-zA-Z0-9]+$/, '');
	if (baseId !== id && dict[baseId] !== undefined) return baseId;

	return id;
}

/**
 * Récupère le nom traduit d'un style à partir de son identifiant.
 * @param id Identifiant du style.
 * @param LL Fonctions de traduction.
 * @returns Le nom traduit, ou l'identifiant brut si aucune traduction n'est trouvée.
 */
export function getStyleName(id: string, LL: TranslationFunctions): string {
	const resolvedId = resolveStyleId(id, LL);
	const nameFn = (LL.editor.styleName as Record<string, () => string>)[resolvedId];
	return nameFn ? nameFn() : id;
}

/**
 * Récupère la description traduite d'un style à partir de son identifiant.
 * @param id Identifiant du style.
 * @param LL Fonctions de traduction.
 * @returns La description traduite, ou une chaîne vide si aucune traduction n'est trouvée.
 */
export function getStyleDescription(id: string, LL: TranslationFunctions): string {
	const resolvedId = resolveStyleId(id, LL);
	const descFn = (LL.editor.styleDescription as Record<string, () => string>)[resolvedId];
	return descFn ? descFn() : '';
}
