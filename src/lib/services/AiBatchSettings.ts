import type { AITranslationSettings } from '$lib/classes/Settings.svelte';
import type settingsCopy from '$lib/i18n/en/settings';

export const ANALYSIS_BATCH_SIZES = [2000, 500, 250, 100, 50, 25];
export const TRANSLATION_BATCH_SIZES = [8000, 3000, 1500, 650, 300, 150];
export type AiBatchCopy = { [K in keyof typeof settingsCopy.aiBatches]: () => string };
type BatchSettings = Partial<
	Pick<AITranslationSettings, 'analysisBatchSize' | 'projectTranslationBatchWords'>
>;

/**
 * Borne une taille persistée et remplace les valeurs invalides par le défaut.
 * @param {unknown} value Taille enregistrée.
 * @param {number[]} sizes Tailles proposées, de la plus grande à la plus petite.
 * @param {number} fallback Taille par défaut.
 * @returns {number} Taille entière valide.
 */
export function normalizeAiBatchSize(value: unknown, sizes: number[], fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.min(sizes[0], Math.max(sizes[sizes.length - 1], Math.round(value)))
		: fallback;
}

/**
 * Résout les mêmes budgets pour l'API et le copier-coller.
 * @param {BatchSettings} settings Préférences persistées.
 * @param {boolean} translation Utiliser le budget de traduction.
 * @returns {{items: number; words: number; characters: number}} Limites du passage, hors contexte.
 */
export function getAiBatchLimits(
	settings: BatchSettings = {},
	translation = false
): {
	items: number;
	words: number;
	characters: number;
} {
	const items = normalizeAiBatchSize(settings.analysisBatchSize, ANALYSIS_BATCH_SIZES, 100);
	const words = translation
		? normalizeAiBatchSize(settings.projectTranslationBatchWords, TRANSLATION_BATCH_SIZES, 650)
		: Math.min(8000, Math.round(items * 6.5));
	return {
		items,
		words,
		characters: translation
			? Math.min(120000, Math.max(6000, Math.round((words / 650) * 24000)))
			: Math.min(60000, Math.max(1500, items * 60))
	};
}

/**
 * Délimite un lot sans couper un élément, même s'il dépasse seul le budget de texte.
 * @param {readonly {text: string}[]} entries Éléments chronologiques.
 * @param {number} offset Premier élément du lot.
 * @param {number} size Nombre maximal d'éléments.
 * @param {number} maxCharacters Budget de texte source.
 * @returns {number} Index de fin exclusif.
 */
export function getAiBatchEnd(
	entries: readonly { text: string }[],
	offset: number,
	size: number,
	maxCharacters: number
): number {
	let end = offset;
	let characters = 0;
	while (end < entries.length && end - offset < size) {
		const length = entries[end].text.length;
		if (end > offset && characters + length > maxCharacters) break;
		characters += length;
		end++;
	}
	return end;
}
