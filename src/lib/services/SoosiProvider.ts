/**
 * Soosi (Abu Amr / al-Sūsī) qira'at text provider.
 *
 * Source: fawazahmed0/quran-api `ara-quransoosi` (KFGQPC, renumbered to standard
 * Hafs ayah indexing — 6,236 verses). Bundled at /soosi/verses.json.
 *
 * Soosi orthography sometimes splits/merges words slightly differently from
 * Hafs within the same ayah, so word-range slicing is best-effort. When the
 * Hafs word indices don't fit the Soosi tokenisation, fall back to the full
 * ayah so the user always sees correct content.
 */

import { globalState } from '$lib/runes/main.svelte';

let versesCache: Record<string, string> | null = null;
let loadingPromise: Promise<Record<string, string>> | null = null;
const tokensCache = new Map<string, string[]>();

/**
 * Soosi orthography splits some word endings across whitespace. The right
 * way to glue them back depends on which kind of continuation it is:
 *
 *  - tanwīn-alif (e.g. "jamīlan", "wakīlan", with optional pause mark on
 *    the trailing alif) → stem + bare alif. Font expects the alif to be a
 *    separate post-space glyph; concatenating without space breaks final-
 *    letter ligatures (lām/ḥāʾ/jīm/rāʾ/mīm get oversized). KEEP SPACE.
 *
 *  - imāla suffix ("Mūsā" → "Mūsē", "al-ūlā" → "al-ūlē", "hudā" → "hudē"):
 *    stem ends with U+065C (small low yeh) or similar imāla marker, suffix
 *    is bare ى / يٰ / يٰۖ. The visual is a single ligated word with a dot
 *    beneath; the font joins the suffix's yāʾ in final form to the preceding
 *    letter. The whitespace prevents that join. JOIN WITH NO SEPARATOR so
 *    Arabic shaping treats the whole sequence as one word.
 *
 * Either way the result is a single logical token, so 1:1 alignment with
 * Hafs word indexing is preserved (~98.3% of verses; the rest are genuine
 * Soosi/Hafs word-split differences and fall back to whole-ayah rendering).
 */
const ALIF_BASE = 'ا'; // U+0627 — tanwīn-alif suffix; keep visual whitespace.
const IMALA_BASES = new Set(['ى', 'ي']); // U+0649, U+064A — imāla; join.
function continuationJoiner(tok: string): string | null {
	if (tok.length === 0 || tok.length > 3) return null;
	if (tok[0] === ALIF_BASE) return ' ';
	if (IMALA_BASES.has(tok[0])) return '';
	return null;
}

function tokenize(verseText: string): string[] {
	const raw = verseText.trim().split(/\s+/);
	const merged: string[] = [];
	for (const tok of raw) {
		const joiner = merged.length > 0 ? continuationJoiner(tok) : null;
		if (joiner !== null) {
			merged[merged.length - 1] += joiner + tok;
		} else {
			merged.push(tok);
		}
	}
	return merged;
}

function getTokens(key: string, verseText: string): string[] {
	let cached = tokensCache.get(key);
	if (!cached) {
		cached = tokenize(verseText);
		tokensCache.set(key, cached);
	}
	return cached;
}

/**
 * Remap dataset codepoints onto codepoints the KFGQPC Soosi font (v0.09, 2010)
 * actually has glyphs for — or onto codepoints whose shaping behaves correctly
 * in WKWebView/CoreText.
 *
 * 1. Open tanwīn marks (Unicode 6.0): the fawazahmed0 dataset uses U+08F0/F1/F2
 *    but the font predates that block and has no glyphs for them. Remap to the
 *    legacy KFGQPC codepoints. Equivalences confirmed by verse-occurrence
 *    counts in both datasets:
 *      U+08F0 (open fathatan, 1975)  → U+0657 (inverted damma, 1969 in orig)
 *      U+08F1 (open dammatan, 1245)  → U+065E (fatha with two dots, 1245)
 *      U+08F2 (open kasratan, 1376)  → U+0656 (subscript alef, 1373)
 *
 * 2. Hamzatul-wasl composite (alif + vowel + U+06EC small high stop) in three
 *    vowel variants. The font's GPOS mark anchors break in WKWebView for these
 *    sequences, leaving the vowel mark floating mid-line. Collapse all three
 *    to U+0671 (ٱ alef wasla), which the font renders as a single clean glyph.
 *    The vowel hint is dropped — Soosi mushafs print these uniformly anyway.
 *
 * 3. Imāla mark: fawazahmed0 uses U+065C (small low yeh, 566 verses) but the
 *    KFGQPC font's mark anchors for U+065C have horizontal advance, breaking
 *    the lām-yāʾ ligature. The original KFGQPC dataset uses U+06ED (small low
 *    meem, 568 verses) — the font's "downo" glyph, a true zero-width
 *    combining mark — for the same imāla. Remap U+065C → U+06ED.
 */
function remapToFontCodepoints(text: string): string {
	return text
		.replace(/ا[َُِ]۬/g, 'ٱ')
		.replace(/ٜ/g, 'ۭ')
		.replace(/[ࣰࣱࣲ]/g, (ch) => {
			switch (ch.charCodeAt(0)) {
				case 0x08f0:
					return 'ٗ';
				case 0x08f1:
					return 'ٞ';
				case 0x08f2:
					return 'ٖ';
				default:
					return ch;
			}
		});
}

async function loadVerses(): Promise<Record<string, string>> {
	if (versesCache) return versesCache;
	if (loadingPromise) return loadingPromise;

	loadingPromise = (async () => {
		const res = await fetch('/soosi/verses.json');
		if (!res.ok) throw new Error(`Failed to load Soosi verses: ${res.status}`);
		const raw = (await res.json()) as Record<string, string>;
		const remapped: Record<string, string> = {};
		for (const key in raw) remapped[key] = remapToFontCodepoints(raw[key]);
		versesCache = remapped;
		// Trigger preview refresh now that text becomes available.
		try {
			globalState.updateVideoPreviewUI();
		} catch {
			// Preview update failures shouldn't prevent caching.
		}
		return versesCache;
	})();

	try {
		return await loadingPromise;
	} finally {
		loadingPromise = null;
	}
}

export class SoosiProvider {
	static async prefetch(): Promise<void> {
		await loadVerses();
	}

	/** True once the verses JSON has loaded into memory. */
	static isReady(): boolean {
		return versesCache !== null;
	}

	/** Synchronous getter — returns null until prefetch resolves. */
	static getVerseSync(surah: number, verse: number): string | null {
		if (!versesCache) {
			void loadVerses();
			return null;
		}
		return versesCache[`${surah}:${verse}`] ?? null;
	}

	/**
	 * Slice the Soosi ayah by Hafs word indices on a best-effort basis.
	 * Returns whole ayah if indices don't fit the Soosi tokenisation.
	 */
	static getVerseSlice(
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number,
		isLastWordsOfVerse: boolean
	): string | null {
		const key = `${surah}:${verse}`;
		const full = this.getVerseSync(surah, verse);
		if (!full) return null;

		const tokens = getTokens(key, full);

		// Whole-ayah request, or out-of-range indices → return everything.
		if (
			(startWordIndex <= 0 && isLastWordsOfVerse) ||
			startWordIndex < 0 ||
			endWordIndex >= tokens.length ||
			startWordIndex > endWordIndex
		) {
			return tokens.join(' ');
		}

		return tokens.slice(startWordIndex, endWordIndex + 1).join(' ');
	}
}

export default SoosiProvider;
