import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const QURAN_DIR = path.join(ROOT_DIR, 'static', 'quran');

const QURAN_CAPTION_BASE_URL = 'https://qurancaption.com';
const QDC_DIRECT_BASE_URL = 'https://api.qurancdn.com/api/qdc';
const BIDI_CONTROL_RE = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/gu;
const INDO_PAK_STOP_SIGN_CHARS =
	'\u06D6\u06D7\u06D8\u06D9\u06DA\u06DB\u06DC\u06E2\u0615\u06EA\u06EB\u0617\u06E5';
const INDO_PAK_SPACE_BEFORE_STOP_SIGN_RE = new RegExp(
	`[\\s\\u200B\\u2060\\uFEFF]+([${INDO_PAK_STOP_SIGN_CHARS}])`,
	'gu'
);

async function readJson(filePath) {
	const content = await fs.readFile(filePath, 'utf8');
	return JSON.parse(content);
}

async function writeJsonCompact(filePath, data) {
	await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
}

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeArabicWord(value) {
	return String(value ?? '')
		.replace(BIDI_CONTROL_RE, '')
		.replace(INDO_PAK_SPACE_BEFORE_STOP_SIGN_RE, '$1')
		.trim();
}

async function fetchChapterFromProxy(chapterId) {
	const url = `${QURAN_CAPTION_BASE_URL}/api/quran/content/chapter-indopak?chapterId=${chapterId}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Proxy HTTP ${response.status}`);
	}
	return response.json();
}

async function fetchChapterFromDirectQdc(chapterId) {
	const verses = [];
	let page = 1;
	const visitedPages = new Set();

	while (true) {
		if (visitedPages.has(page)) break;
		visitedPages.add(page);

		const searchParams = new URLSearchParams({
			words: 'true',
			word_fields: 'text_indopak',
			mushaf: '3',
			page: String(page)
		});

		const url = `${QDC_DIRECT_BASE_URL}/verses/by_chapter/${chapterId}?${searchParams.toString()}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Direct QDC HTTP ${response.status}`);
		}

		const payload = await response.json();
		const currentVerses = Array.isArray(payload.verses) ? payload.verses : [];

		for (const verse of currentVerses) {
			const verseNumber = Number(verse.verse_number);
			const verseKey = typeof verse.verse_key === 'string' ? verse.verse_key : '';
			if (!Number.isInteger(verseNumber) || verseNumber <= 0 || !verseKey) continue;

			const words = (Array.isArray(verse.words) ? verse.words : [])
				.filter((word) => word?.char_type_name === 'word' && typeof word?.text_indopak === 'string')
				.map((word) => sanitizeArabicWord(word.text_indopak))
				.filter(Boolean);

			verses.push({
				verseNumber,
				verseKey,
				words
			});
		}

		const rawNextPage = payload?.pagination?.next_page;
		const nextPage =
			typeof rawNextPage === 'number'
				? rawNextPage
				: typeof rawNextPage === 'string'
					? Number(rawNextPage)
					: NaN;

		if (!Number.isInteger(nextPage) || nextPage <= page) break;
		page = nextPage;
	}

	return {
		chapterId,
		script: 'text_indopak',
		mushaf: 3,
		verses
	};
}

async function fetchChapterIndopak(chapterId) {
	try {
		return await fetchChapterFromProxy(chapterId);
	} catch (proxyError) {
		console.warn(`[${chapterId}] Proxy unavailable (${String(proxyError)}), fallback direct QDC.`);
		return fetchChapterFromDirectQdc(chapterId);
	}
}

function buildVerseWordsMap(payload) {
	const map = new Map();
	const verses = Array.isArray(payload?.verses) ? payload.verses : [];

	for (const verse of verses) {
		const verseNumber = Number(verse?.verseNumber);
		if (!Number.isInteger(verseNumber) || verseNumber <= 0) continue;

		const words = (Array.isArray(verse?.words) ? verse.words : [])
			.map((word) => String(word).trim())
			.filter(Boolean);

		map.set(verseNumber, words);
	}

	return map;
}

async function updateChapterFile(chapterId) {
	const filePath = path.join(QURAN_DIR, `${chapterId}.json`);
	const local = await readJson(filePath);
	const payload = await fetchChapterIndopak(chapterId);
	const verseWordsMap = buildVerseWordsMap(payload);

	let updatedWords = 0;
	let fallbackWords = 0;
	let missingVerses = 0;

	for (const [verseKey, verseData] of Object.entries(local)) {
		const verseNumber = Number(verseKey);
		const localWords = Array.isArray(verseData?.w) ? verseData.w : [];
		const indopakWords = verseWordsMap.get(verseNumber);

		if (!indopakWords) {
			missingVerses += 1;
		}

		for (let i = 0; i < localWords.length; i++) {
			const localWord = localWords[i];
			const indopak = indopakWords?.[i];
			if (typeof indopak === 'string' && indopak.trim()) {
				localWord.i = sanitizeArabicWord(indopak);
				updatedWords += 1;
			} else {
				localWord.i = sanitizeArabicWord(localWord?.c ?? '');
				fallbackWords += 1;
			}
		}
	}

	await writeJsonCompact(filePath, local);

	return { updatedWords, fallbackWords, missingVerses };
}

async function main() {
	console.log('Sync IndoPak text into static/quran/*.json');
	let totalUpdated = 0;
	let totalFallback = 0;
	let totalMissingVerses = 0;

	for (let chapterId = 1; chapterId <= 114; chapterId++) {
		try {
			const result = await updateChapterFile(chapterId);
			totalUpdated += result.updatedWords;
			totalFallback += result.fallbackWords;
			totalMissingVerses += result.missingVerses;

			console.log(
				`[${chapterId}] ok | words:${result.updatedWords} fallback:${result.fallbackWords} missingVerses:${result.missingVerses}`
			);
		} catch (error) {
			console.error(`[${chapterId}] failed:`, error);
		}

		// Small delay to avoid bursting the remote API too aggressively.
		await sleep(40);
	}

	console.log('Done.');
	console.log(
		`Totals -> updatedWords:${totalUpdated}, fallbackWords:${totalFallback}, missingVerses:${totalMissingVerses}`
	);
}

void main();
