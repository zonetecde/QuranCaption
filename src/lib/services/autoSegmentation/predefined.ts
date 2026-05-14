import type { PredefinedType } from './types';
import { canonicalizePredefinedSubtitleType } from '$lib/classes/Clip.svelte';

/**
 * Détermine le type prédéfini d'un segment (Basmala, Isti'adha, etc.)
 * à partir de sa référence et de son type spécial.
 *
 * @param {string | undefined} ref Référence du segment (ex: "1:1:1").
 * @param {string | undefined} specialType Type spécial explicite.
 * @returns {PredefinedType | null} Type prédéfini identifié, ou null.
 */
export function getPredefinedType(ref?: string, specialType?: string): PredefinedType | null {
	const explicitType = canonicalizePredefinedSubtitleType(specialType);
	if (explicitType !== 'Other') return explicitType;

	if (!ref) return null;
	const normalized = ref.toLowerCase().trim();

	if (
		normalized.includes("isti'adha") ||
		normalized.includes('istiadha') ||
		normalized.includes('isti')
	) {
		return "Isti'adha";
	}
	if (normalized.includes('basmala')) return 'Basmala';
	if (normalized.includes('amin') || normalized.includes('ameen')) return 'Amin';
	if (normalized.includes('takbir')) return 'Takbir';
	if (normalized.includes('tahmeed') || normalized.includes('hamidah')) return 'Tahmeed';
	if (normalized.includes('tasleem') || normalized.includes('salam')) return 'Tasleem';
	if (
		normalized.includes('sadaqa') ||
		normalized.includes('sadaqallah') ||
		normalized.includes('sadaqallahul azim')
	) {
		return 'Sadaqa';
	}

	return null;
}
