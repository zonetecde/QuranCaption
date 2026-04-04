const QURAN_CAPTION_WEBSITE_BASE_URL = 'https://qurancaption.com';

export type QdcRecitation = {
	id: number;
	reciter_name: string;
	style?: string;
	translated_name?: {
		name?: string;
		language_name?: string;
	};
};

export type QdcChapterAudioTimestamp = {
	verse_key: string;
	timestamp_from: number;
	timestamp_to: number;
	duration: number;
	segments?: number[][];
};

export type QdcChapterAudio = {
	id: number;
	chapter_id: number;
	file_size: number;
	format: string;
	audio_url: string;
	timestamps?: QdcChapterAudioTimestamp[];
};

type QdcRecitationsResponse = {
	recitations: QdcRecitation[];
};

type QdcChapterAudioResponse = {
	audio_file: QdcChapterAudio;
};

export class QdcRecitationService {
	/** Récupère la liste des récitations QDC via le proxy Quran Caption. */
	static async getRecitations(): Promise<QdcRecitation[]> {
		try {
			const response = await fetch(`${QURAN_CAPTION_WEBSITE_BASE_URL}/api/quran/content/recitations`);
			if (!response.ok) throw new Error('Failed to fetch QDC recitations');
			const data = (await response.json()) as QdcRecitationsResponse;
			return data.recitations || [];
		} catch (error) {
			console.error('QdcRecitationService.getRecitations error:', error);
			return [];
		}
	}

	/** Récupère l'audio d'une sourate et, si demandé, les timestamps officiels QDC. */
	static async getChapterAudio(
		recitationId: number,
		chapterId: number,
		includeSegments: boolean = false
	): Promise<QdcChapterAudio | null> {
		try {
			const searchParams = new URLSearchParams({
				recitationId: String(recitationId),
				chapterId: String(chapterId)
			});
			if (includeSegments) {
				searchParams.set('segments', 'true');
			}

			const response = await fetch(
				`${QURAN_CAPTION_WEBSITE_BASE_URL}/api/quran/content/chapter-audio?${searchParams.toString()}`
			);
			if (!response.ok) throw new Error('Failed to fetch QDC chapter audio');
			const data = (await response.json()) as QdcChapterAudioResponse;
			return data.audio_file ?? null;
		} catch (error) {
			console.error('QdcRecitationService.getChapterAudio error:', error);
			return null;
		}
	}

	/** Vérifie rapidement si le fichier audio QDC pointé existe réellement côté upstream. */
	static async isAudioUrlAvailable(audioUrl: string): Promise<boolean> {
		try {
			const response = await fetch(audioUrl, {
				method: 'HEAD'
			});

			// Certains CDN ne gèrent pas toujours HEAD proprement, donc on accepte aussi 200-399.
			return response.ok || (response.status >= 300 && response.status < 400);
		} catch (error) {
			console.error('QdcRecitationService.isAudioUrlAvailable error:', error);
			return false;
		}
	}
}
