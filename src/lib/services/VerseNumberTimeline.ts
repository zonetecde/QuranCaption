import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { isNonHafsRiwayah, RiwayahProvider } from '$lib/services/RiwayahProvider';

/**
 * Résout le numéro ou la plage de versets selon la riwayah effective du clip.
 * @param {SubtitleClip} subtitle Sous-titre à résoudre.
 * @returns {number | string} Numéro affiché, ou une chaîne vide sans numéro disponible.
 */
export function getDisplayedVerseNumber(subtitle: SubtitleClip): number | string {
	const riwayah = globalState.getVideoStyle
		.getStylesOfTarget('arabic')
		.getEffectiveValue('riwayah', subtitle.id);
	if (isNonHafsRiwayah(riwayah)) {
		const slice = RiwayahProvider.getVerseSlice(
			riwayah,
			subtitle.surah,
			subtitle.verse,
			subtitle.startWordIndex,
			subtitle.endWordIndex,
			false
		);
		return slice?.targetAyahs.join('-') ?? '';
	}
	return subtitle.verse;
}
