import {
	isFullHafsReciterId,
	isFullHafsMoshaf,
	Mp3QuranService
} from '$lib/services/Mp3QuranService';
import type { ReciterOption } from './types';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Charge la liste des recitateurs Hafs A'n Assem / 114 sourates depuis MP3Quran
 * et la stocke dans globalState.aiVideo.
 * @returns {Promise<void>}
 */
export async function loadHafsReciters(): Promise<void> {
	const aiv = globalState.aiVideo;
	if (aiv.reciterOptions.length > 0) {
		aiv.isLoadingReciters = false;
		return;
	}
	try {
		const mp3Reciters = await Mp3QuranService.getReciters();
		const options: ReciterOption[] = [];
		for (const rec of mp3Reciters) {
			for (const moshaf of rec.moshaf) {
				if (!isFullHafsReciterId(rec.id) || !isFullHafsMoshaf(moshaf)) continue;
				options.push({
					label: `${rec.name} — ${moshaf.name}`,
					reciterName: rec.name,
					moshaf,
					reciterId: rec.id,
					surahSet: new Set(moshaf.surah_list.split(',').map(Number))
				});
			}
		}
		aiv.reciterOptions = options.sort((a, b) => a.label.localeCompare(b.label));
	} catch (error) {
		console.error('[AiVideo] Failed to load mp3quran reciters:', error);
	} finally {
		aiv.isLoadingReciters = false;
	}
}

/**
 * Retourne la cle stable utilisee par les selects recitateur.
 * @param {ReciterOption} option Option de recitateur MP3Quran.
 * @returns {string} Cle unique recitateur/moshaf.
 */
export function getReciterOptionKey(option: ReciterOption): string {
	return `${option.reciterId}:${option.moshaf.id}`;
}

/**
 * Resout un recitateur a partir de son identifiant MP3Quran (issu du plan IA).
 * @param {number} reciterId Identifiant MP3Quran du recitateur.
 * @returns {ReciterOption | null} Option resolue, ou null si non trouvee.
 */
export function resolveAiReciterOption(reciterId: number): ReciterOption | null {
	if (!isFullHafsReciterId(reciterId)) return null;
	return globalState.aiVideo.reciterOptions.find((o) => o.reciterId === reciterId) ?? null;
}

/**
 * Construit la liste des recitateurs eligibles pour le prompt IA (format JSON).
 * Dedupliquee par reciterId.
 * @returns {string} Liste JSON d'objets { reciterId, name }.
 */
export function buildReciterListForAi(): string {
	const seen = new Set<number>();
	const lines: string[] = [];
	for (const opt of globalState.aiVideo.reciterOptions) {
		if (!resolveAiReciterOption(opt.reciterId)) continue;
		if (seen.has(opt.reciterId)) continue;
		seen.add(opt.reciterId);
		lines.push(`{ "reciterId": ${opt.reciterId}, "name": "${opt.reciterName}" }`);
	}
	return lines.join('\n');
}

/**
 * Verifie si une sourate est disponible pour un recitateur donne.
 * @param {ReciterOption} option Option de recitateur.
 * @param {number} surah Numero de sourate.
 * @returns {boolean} True si la sourate est disponible.
 */
export function isSurahAvailableForReciter(option: ReciterOption, surah: number): boolean {
	return option.surahSet.has(surah);
}
