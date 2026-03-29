import { globalState } from '$lib/runes/main.svelte';
import { SerializableBase } from './misc/SerializableBase';
import { Quran } from './Quran';

type VersePart = {
	surah: number;
	verseStart: number;
	verseEnd: number;
};

export class VerseRange extends SerializableBase {
	// Ex:
	// [ { surah: 1, verseStart: 1, verseEnd: 7 }, { surah: 2, verseStart: 1, verseEnd: 255 } ]
	parts: VersePart[] = $state([]);

	constructor(parts: VersePart[] = []) {
		super();
		this.parts = parts;
	}

	/**
	 * Récupère la verse range d'un segment vidéo
	 * @param startTime Début du segment
	 * @param endTime Fin du segment
	 */
	static getVerseRange(startTime: number, endTime: number): VerseRange {
		const parts: VersePart[] = [];

		for (const subtitleClip of globalState.getSubtitleClips) {
			// Vérifie que le sous-titre est dans les limites du segment
			// Laisse une marge de 1 seconde pour considérer le sous-titre comme sélectionné
			if (!(subtitleClip.startTime >= startTime - 1000 && subtitleClip.endTime <= endTime + 1000)) {
				continue;
			}

			// Ajoute le sous-titre à la liste des parties
			const existingPart = parts.find((p) => p.surah === subtitleClip.surah);
			if (existingPart) {
				if (existingPart.verseEnd < subtitleClip.verse) {
					existingPart.verseEnd = subtitleClip.verse;
				}
				if (existingPart.verseStart > subtitleClip.verse) {
					existingPart.verseStart = subtitleClip.verse;
				}
			} else {
				parts.push({
					surah: subtitleClip.surah,
					verseStart: subtitleClip.verse,
					verseEnd: subtitleClip.verse
				});
			}
		}

		// Trie les parties par numéro de sourate
		parts.sort((a, b) => a.surah - b.surah);

		return new VerseRange(parts);
	}

	public toString(): string {
		if (this.parts.length === 0) {
			return 'none';
		}

		return this.parts
			.map(
				(part) =>
					`Surah ${Quran.getSurahsNames()[part.surah - 1].transliteration}: ${part.verseStart}${part.verseEnd !== part.verseStart ? '-' + part.verseEnd : ''}`
			)
			.join(', ');
	}

	public toStringForExportFile(): string {
		return this.toString().replaceAll(':', '').replaceAll('Surah ', '');
	}

	public getRangeForSurah(surahNumber: number): { verseStart: number; verseEnd: number } {
		const part = this.parts.find((p) => p.surah === surahNumber);
		if (!part) return { verseStart: 1, verseEnd: Quran.getVerseCount(surahNumber) };

		return {
			verseStart: part.verseStart,
			verseEnd: part.verseEnd
		};
	}

	/**
	 * Récupère la plage de versets pour l'exportation
	 * @returns La plage de versets pour l'exportation
	 */
	static getExportVerseRange() {
		return VerseRange.getVerseRange(
			globalState.getExportState.videoStartTime,
			globalState.getExportState.videoEndTime || Infinity
		);
	}
}
