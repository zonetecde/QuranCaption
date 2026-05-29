export interface Mp3QuranReciter {
	id: number;
	name: string;
	letter: string;
	moshaf: Mp3QuranMoshaf[];
}

export interface Mp3QuranMoshaf {
	id: number;
	name: string;
	server: string;
	surah_total: number;
	moshaf_type: number;
	surah_list: string;
}

export interface TimingReciter {
	id: number;
	name: string;
	rewaya: string;
	folder_url: string;
	soar_count: number;
	soar_link: string;
}

export interface VerseTiming {
	ayah: number;
	polygon: string;
	start_time: number; // ms
	end_time: number; // ms
	x: string;
	y: string;
	page: string;
}

export const FULL_HAFS_MP3QURAN_RECITER_IDS = [
	1, 3, 4, 5, 6, 8, 9, 10, 12, 13, 17, 18, 20, 21, 22, 24, 25, 30, 31, 32, 33, 36, 38, 39, 40, 42,
	43, 44, 46, 47, 48, 49, 50, 51, 54, 55, 56, 58, 59, 60, 61, 62, 63, 64, 66, 67, 69, 70, 71, 72,
	74, 76, 77, 78, 79, 81, 86, 87, 88, 89, 92, 93, 96, 97, 98, 102, 106, 107, 108, 109, 110, 111,
	112, 115, 118, 121, 123, 125, 126, 127, 129, 136, 139, 149, 152, 159, 160, 161, 163, 164, 165,
	178, 181, 193, 197, 198, 201, 202, 203, 206, 217, 219, 221, 225, 229, 230, 236, 243, 244, 245,
	248, 250, 251, 252, 254, 256, 257, 259, 265, 267, 268, 271, 273, 277, 278, 280, 281, 282, 283,
	284, 285, 286, 287, 288, 290, 300, 301, 302, 304, 21136, 21148, 21181, 21182, 21183, 21184, 21186,
	21193, 21196, 21197
];

export const FULL_HAFS_MP3QURAN_RECITER_ID_SET = new Set(FULL_HAFS_MP3QURAN_RECITER_IDS);

/**
 * Indique si un moshaf MP3Quran est Hafs A'n Assem et contient les 114 sourates.
 * @param {Mp3QuranMoshaf} moshaf Moshaf MP3Quran a verifier.
 * @returns {boolean} True si le moshaf est eligible.
 */
export function isFullHafsMoshaf(moshaf: Mp3QuranMoshaf): boolean {
	const moshafName = moshaf.name.toLowerCase();
	const surahCount = moshaf.surah_list.split(',').filter(Boolean).length;
	return (
		moshafName.includes('hafs') &&
		moshafName.includes('assem') &&
		(moshaf.surah_total === 114 || surahCount === 114)
	);
}

/**
 * Indique si un recitateur MP3Quran fait partie des recitateurs Hafs complets autorises.
 * @param {number} reciterId Identifiant MP3Quran du recitateur.
 * @returns {boolean} True si le recitateur est autorise.
 */
export function isFullHafsReciterId(reciterId: number): boolean {
	return FULL_HAFS_MP3QURAN_RECITER_ID_SET.has(reciterId);
}

export class Mp3QuranService {
	private static readonly BASE_URL = 'https://mp3quran.net/api/v3';

	/**
	 * Fetches the list of all reciters from the main API.
	 */
	static async getReciters(language: string = 'eng'): Promise<Mp3QuranReciter[]> {
		try {
			const response = await fetch(`${this.BASE_URL}/reciters?language=${language}`);
			if (!response.ok) throw new Error('Failed to fetch reciters');
			const data = (await response.json()) as { reciters: Mp3QuranReciter[] };
			return data.reciters || [];
		} catch (error) {
			console.error('Mp3QuranService.getReciters error:', error);
			return [];
		}
	}

	/**
	 * Fetches the list of reciters that support Ayat Timing.
	 */
	static async getTimingReciters(): Promise<TimingReciter[]> {
		try {
			const response = await fetch(`${this.BASE_URL}/ayat_timing/reads`);
			if (!response.ok) throw new Error('Failed to fetch timing reciters');
			const data = (await response.json()) as TimingReciter[];
			return data || [];
		} catch (error) {
			console.error('Mp3QuranService.getTimingReciters error:', error);
			return [];
		}
	}

	/**
	 * Fetches the timing data for a specific surah and reciter (readId).
	 * @param readId The reciter ID from the timing API (usually matches the main API ID)
	 * @param surahId The Surah ID (1-114)
	 */
	static async getSurahTiming(readId: number, surahId: number): Promise<VerseTiming[]> {
		try {
			const response = await fetch(`${this.BASE_URL}/ayat_timing?surah=${surahId}&read=${readId}`);
			if (!response.ok) throw new Error('Failed to fetch surah timing');
			const data = (await response.json()) as VerseTiming[];
			return data || [];
		} catch (error) {
			console.error('Mp3QuranService.getSurahTiming error:', error);
			return [];
		}
	}
}
