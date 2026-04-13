import { globalState } from '$lib/runes/main.svelte';

const QURAN_CAPTION_WEBSITE_BASE_URL = 'https://qurancaption.com';
const INDOPAK_FONT_FAMILY = 'IndoPak';

type IndopakChapterResponse = {
	chapterId: number;
	script: 'text_indopak';
	mushaf: 3;
	verses: Array<{
		verseNumber: number;
		verseKey: string;
		words: string[];
	}>;
};

type SegmentRequest = {
	surah: number;
	verse: number;
	startWordIndex: number;
	endWordIndex: number;
	isLastWords: boolean;
	includeVerseNumber: boolean;
};

type LocalQuranWord = {
	c?: string;
	i?: string;
};

type LocalQuranVerse = {
	w?: LocalQuranWord[];
};

export class QdcMushafService {
	private static fontLoadPromise: Promise<boolean> | null = null;
	private static chapterPromises = new Map<number, Promise<Map<number, string[]> | null>>();
	private static chapterWordsCache = new Map<number, Map<number, string[]>>();

	static isIndopakMushafEnabled(): boolean {
		return String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? '') === 'Indopak';
	}

	static getIndopakSegmentText(request: SegmentRequest): string | null {
		void this.ensureIndopakFontLoaded();
		void this.ensureChapterLoaded(request.surah);

		const chapter = this.chapterWordsCache.get(request.surah);
		if (!chapter) return null;

		const verseWords = chapter.get(request.verse);
		if (!verseWords || verseWords.length === 0) return null;

		const boundedStart = Math.max(0, Math.min(request.startWordIndex, verseWords.length - 1));
		const boundedEnd = Math.max(0, Math.min(request.endWordIndex, verseWords.length - 1));
		if (boundedEnd < boundedStart) return null;

		let text = verseWords
			.slice(boundedStart, boundedEnd + 1)
			.join(' ')
			.trim();
		if (!text) return null;

		if (request.includeVerseNumber && request.isLastWords) {
			// Utilise Hafs pour les numéros de verset car Indopak ne les affiche pas
			text += ` <span style="font-family: Hafs;">${this.latinToArabicNumbers(request.verse)}</span>`;
		}

		return text;
	}

	static async prefetchCurrentProjectSurahs(): Promise<void> {
		if (!globalState.currentProject) return;

		const surahIds = Array.from(
			new Set(globalState.getSubtitleClips.map((subtitle) => subtitle.surah))
		).filter((surah) => Number.isInteger(surah) && surah >= 1 && surah <= 114);

		await this.prefetchSurahs(surahIds);
	}

	static async prefetchSurahs(surahIds: number[]): Promise<void> {
		if (surahIds.length === 0) return;

		await this.ensureIndopakFontLoaded();

		const uniqueSurahIds = Array.from(new Set(surahIds)).filter(
			(surah) => Number.isInteger(surah) && surah >= 1 && surah <= 114
		);

		await Promise.all(uniqueSurahIds.map((surah) => this.ensureChapterLoaded(surah)));
	}

	static async ensureIndopakFontLoaded(): Promise<boolean> {
		if (typeof document === 'undefined') return false;

		if (this.fontLoadPromise) return this.fontLoadPromise;

		this.fontLoadPromise = (async () => {
			try {
				const escapedFamily = INDOPAK_FONT_FAMILY.replace(/(["\\])/g, '\\$1');
				const fontSpec = `normal 32px "${escapedFamily}"`;

				if (document.fonts.check(fontSpec)) return true;

				await document.fonts.load(fontSpec);
				return document.fonts.check(fontSpec);
			} catch (error) {
				console.error('QdcMushafService.ensureIndopakFontLoaded error:', error);
				return false;
			}
		})();

		return this.fontLoadPromise;
	}

	private static async ensureChapterLoaded(surah: number): Promise<Map<number, string[]> | null> {
		const cached = this.chapterWordsCache.get(surah);
		if (cached) return cached;

		const inflight = this.chapterPromises.get(surah);
		if (inflight) return inflight;

		const promise = (async () => {
			try {
				const localChapter = await this.loadChapterFromLocalQuran(surah);
				if (localChapter) {
					this.chapterWordsCache.set(surah, localChapter);
					return localChapter;
				}

				const searchParams = new URLSearchParams({
					chapterId: String(surah)
				});
				const response = await fetch(
					`${QURAN_CAPTION_WEBSITE_BASE_URL}/api/quran/content/chapter-indopak?${searchParams.toString()}`
				);
				if (!response.ok) {
					throw new Error('Failed to fetch IndoPak chapter data.');
				}

				const payload = (await response.json()) as IndopakChapterResponse;
				const byVerse = new Map<number, string[]>();
				for (const verse of payload.verses || []) {
					const verseNumber = Number(verse.verseNumber);
					if (!Number.isInteger(verseNumber) || verseNumber <= 0) continue;

					const words = Array.isArray(verse.words)
						? verse.words.map((word) => String(word).trim()).filter((word) => word.length > 0)
						: [];

					byVerse.set(verseNumber, words);
				}

				this.chapterWordsCache.set(surah, byVerse);
				return byVerse;
			} catch (error) {
				console.error('QdcMushafService.ensureChapterLoaded error:', error);
				return null;
			} finally {
				this.chapterPromises.delete(surah);
			}
		})();

		this.chapterPromises.set(surah, promise);
		return promise;
	}

	private static async loadChapterFromLocalQuran(surah: number): Promise<Map<number, string[]> | null> {
		try {
			const response = await fetch(`/quran/${surah}.json`);
			if (!response.ok) return null;

			const payload = (await response.json()) as Record<string, LocalQuranVerse>;
			const byVerse = new Map<number, string[]>();
			let hasAtLeastOneIndopakWord = false;

			for (const [verseKey, verseData] of Object.entries(payload)) {
				const verseNumber = Number(verseKey);
				if (!Number.isInteger(verseNumber) || verseNumber <= 0) continue;

				const words = (Array.isArray(verseData?.w) ? verseData.w : [])
					.map((word) => {
						const indopak = String(word?.i ?? '').trim();
						const fallback = String(word?.c ?? '').trim();
						if (indopak.length > 0) {
							hasAtLeastOneIndopakWord = true;
							return indopak;
						}
						return fallback;
					})
					.filter((word) => word.length > 0);

				byVerse.set(verseNumber, words);
			}

			return hasAtLeastOneIndopakWord ? byVerse : null;
		} catch (error) {
			console.warn('QdcMushafService.loadChapterFromLocalQuran error:', error);
			return null;
		}
	}

	private static latinToArabicNumbers(value: number): string {
		return String(value).replace(/\d/g, (digit) => {
			const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
			return arabicDigits[Number(digit)] ?? digit;
		});
	}
}
