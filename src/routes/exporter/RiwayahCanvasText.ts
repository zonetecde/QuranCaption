import type { NonHafsRiwayah } from '$lib/services/RiwayahProvider';
import createHarfBuzz from 'harfbuzzjs/hb.js';
import wrapHarfBuzz, { type Font, type HarfBuzz } from 'harfbuzzjs/hbjs.js';
import wasmUrl from 'harfbuzzjs/hb.wasm?url';

export type RiwayahWordPath = { outline: Path2D; advance: number; unitsPerEm: number };

const fonts = new Map<NonHafsRiwayah, Promise<{ font: Font; unitsPerEm: number }>>();
const wordPaths = new Map<string, RiwayahWordPath>();
let harfBuzz: Promise<HarfBuzz> | undefined;

/**
 * Charge le moteur de positionnement OpenType au premier sous-titre riwayah.
 * @returns {Promise<HarfBuzz>} Moteur partagé par les captures du worker.
 */
function loadHarfBuzz(): Promise<HarfBuzz> {
	harfBuzz ??= createHarfBuzz({ locateFile: () => wasmUrl })
		.then(wrapHarfBuzz)
		.catch((error: unknown) => {
			harfBuzz = undefined;
			throw error;
		});
	return harfBuzz;
}

/**
 * Ouvre la police KFGQPC d'origine et conserve sa face pour les prochaines captures.
 * @param {HarfBuzz} hb Moteur de positionnement chargé.
 * @param {NonHafsRiwayah} riwayah Lecture associée à la famille CSS.
 * @returns {Promise<{ font: Font; unitsPerEm: number }>} Police et échelle de ses glyphes.
 */
async function loadFont(hb: HarfBuzz, riwayah: NonHafsRiwayah) {
	const response = await fetch(`/riwayat/${riwayah.toLowerCase()}/font.ttf`);
	if (!response.ok)
		throw new Error(`Could not load the ${riwayah} export font: ${response.status}`);
	const blob = hb.createBlob(await response.arrayBuffer());
	const face = hb.createFace(blob, 0);
	try {
		return { font: hb.createFont(face), unitsPerEm: face.upem };
	} finally {
		face.destroy();
		blob.destroy();
	}
}

/**
 * Positionne les lettres et les voyelles d'un mot en unités de police.
 * @param {NonHafsRiwayah} riwayah Police à utiliser pour le mot.
 * @param {string} text Mot arabe avec ses signes.
 * @returns {Promise<RiwayahWordPath | null>} Tracé et avance naturelle, ou repli sur le canvas natif.
 */
export async function getRiwayahWordPath(
	riwayah: NonHafsRiwayah,
	text: string
): Promise<RiwayahWordPath | null> {
	const key = `${riwayah}:${text}`;
	const cached = wordPaths.get(key);
	if (cached) return cached;
	const hb = await loadHarfBuzz();
	let loadingFont = fonts.get(riwayah);
	if (!loadingFont) {
		loadingFont = loadFont(hb, riwayah).catch((error: unknown) => {
			fonts.delete(riwayah);
			throw error;
		});
		fonts.set(riwayah, loadingFont);
	}
	const { font, unitsPerEm } = await loadingFont;
	const loaded = wordPaths.get(key);
	if (loaded) return loaded;
	const buffer = hb.createBuffer();
	try {
		buffer.addText(text);
		buffer.setLanguage('ar');
		buffer.guessSegmentProperties();
		hb.shape(font, buffer);
		const outline = new Path2D();
		let advance = 0;
		for (const glyph of buffer.json()) {
			if (!glyph.g) return null;
			outline.addPath(
				new Path2D(font.glyphToPath(glyph.g)),
				new DOMMatrix([1, 0, 0, -1, advance + glyph.dx, -glyph.dy])
			);
			advance += glyph.ax;
		}
		const word = { outline, advance, unitsPerEm };
		if (wordPaths.size >= 256) wordPaths.delete(wordPaths.keys().next().value!);
		wordPaths.set(key, word);
		return word;
	} finally {
		buffer.destroy();
	}
}
