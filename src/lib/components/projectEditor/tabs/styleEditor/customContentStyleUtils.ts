import type { Category, Style } from '$lib/classes/VideoStyle.svelte';
import LL from '$lib/i18n/i18n-svelte';
import { getStyleName } from '$lib/i18n/styleMapper';
import { globalState } from '$lib/runes/main.svelte';
import { get } from 'svelte/store';

/**
 * Indique si un style personnalisé est inutile dans son contexte courant.
 * @param {Category} category Catégorie du style.
 * @param {Style} style Style évalué.
 * @returns {boolean} `true` si le contrôle doit être masqué.
 */
export function isCustomStyleInactive(category: Category, style: Style): boolean {
	if (
		['time-appearance', 'time-disappearance'].includes(style.id) &&
		Boolean(category.getStyle('always-show')?.value)
	)
		return true;

	if (
		category.id.startsWith('custom-image') &&
		style.id !== 'filepath' &&
		!category.getStyle('filepath')?.value
	)
		return true;

	return style.id === 'above-overlay' && !globalState.getStyle('global', 'overlay-enable')?.value;
}

/**
 * Indique si un style personnalisé correspond à une recherche.
 * @param {Style} style Style évalué.
 * @param {Category} category Catégorie du style.
 * @param {string} query Recherche normalisée.
 * @returns {boolean} `true` si le style correspond.
 */
export function matchesCustomStyleSearch(style: Style, category: Category, query: string): boolean {
	if (query === '') return true;
	const LL_ = get(LL);
	return (
		style.name.toLowerCase().includes(query) ||
		getStyleName(style.id, LL_).toLowerCase().includes(query) ||
		category.name.toLowerCase().includes(query) ||
		getStyleName(category.id, LL_).toLowerCase().includes(query)
	);
}

/**
 * Retourne les styles personnalisés visibles pour une recherche.
 * @param {Category} category Catégorie à filtrer.
 * @param {string} query Recherche normalisée.
 * @returns {Style[]} Styles visibles.
 */
export function getVisibleCustomStyles(category: Category, query: string): Style[] {
	return category.styles.filter(
		(style) =>
			matchesCustomStyleSearch(style, category, query) && !isCustomStyleInactive(category, style)
	);
}
