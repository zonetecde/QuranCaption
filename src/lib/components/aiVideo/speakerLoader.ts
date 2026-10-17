import {
	isFullHafsSpeakerId,
	isFullHafsMoshaf,
	Mp3QuranService
} from '$lib/services/Mp3QuranService';
import type { SpeakerOption } from './types';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Charge la liste des intervenants Hafs A'n Assem / 114 sourates depuis MP3Quran
 * et la stocke dans globalState.aiVideo.
 * @returns {Promise<void>}
 */
export async function loadHafsSpeakers(): Promise<void> {
	const aiv = globalState.aiVideo;
	if (aiv.speakerOptions.length > 0) {
		aiv.isLoadingSpeakers = false;
		return;
	}
	try {
		const mp3Speakers = await Mp3QuranService.getSpeakers();
		const options: SpeakerOption[] = [];
		for (const rec of mp3Speakers) {
			for (const moshaf of rec.moshaf) {
				if (!isFullHafsSpeakerId(rec.id) || !isFullHafsMoshaf(moshaf)) continue;
				options.push({
					label: `${rec.name} — ${moshaf.name}`,
					speakerName: rec.name,
					moshaf,
					speakerId: rec.id,
					surahSet: new Set(moshaf.surah_list.split(',').map(Number))
				});
			}
		}
		aiv.speakerOptions = options.sort((a, b) => a.label.localeCompare(b.label));
	} catch (error) {
		console.error('[AiVideo] Failed to load mp3quran speakers:', error);
	} finally {
		aiv.isLoadingSpeakers = false;
	}
}

/**
 * Retourne la cle stable utilisee par les selects intervenant.
 * @param {SpeakerOption} option Option de intervenant MP3Quran.
 * @returns {string} Cle unique intervenant/moshaf.
 */
export function getSpeakerOptionKey(option: SpeakerOption): string {
	return `${option.speakerId}:${option.moshaf.id}`;
}

/**
 * Resout un intervenant a partir de son identifiant MP3Quran (issu du plan IA).
 * @param {number} speakerId Identifiant MP3Quran de l’intervenant.
 * @returns {SpeakerOption | null} Option resolue, ou null si non trouvee.
 */
export function resolveAiSpeakerOption(speakerId: number): SpeakerOption | null {
	if (!isFullHafsSpeakerId(speakerId)) return null;
	return globalState.aiVideo.speakerOptions.find((o) => o.speakerId === speakerId) ?? null;
}

/**
 * Construit la liste des intervenants eligibles pour le prompt IA (format JSON).
 * Dedupliquee par speakerId.
 * @returns {string} Liste JSON d'objets { speakerId, name }.
 */
export function buildSpeakerListForAi(): string {
	const seen = new Set<number>();
	const lines: string[] = [];
	for (const opt of globalState.aiVideo.speakerOptions) {
		if (!resolveAiSpeakerOption(opt.speakerId)) continue;
		if (seen.has(opt.speakerId)) continue;
		seen.add(opt.speakerId);
		lines.push(`{ "speakerId": ${opt.speakerId}, "name": "${opt.speakerName}" }`);
	}
	return lines.join('\n');
}

/**
 * Verifie si une sourate est disponible pour un intervenant donne.
 * @param {SpeakerOption} option Option de intervenant.
 * @param {number} surah Numero de sourate.
 * @returns {boolean} True si la sourate est disponible.
 */
export function isSurahAvailableForSpeaker(option: SpeakerOption, surah: number): boolean {
	return option.surahSet.has(surah);
}
