

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
