import subsetWasmUrl from 'harfbuzzjs/hb-subset.wasm?url';

type HarfBuzzSubsetExports = {
	memory: WebAssembly.Memory;
	malloc(size: number): number;
	free(pointer: number): void;
	hb_blob_create(
		data: number,
		length: number,
		mode: number,
		userData: number,
		destroy: number
	): number;
	hb_blob_destroy(blob: number): void;
	hb_blob_get_data(blob: number, length: number): number;
	hb_blob_get_length(blob: number): number;
	hb_face_create(blob: number, index: number): number;
	hb_face_destroy(face: number): void;
	hb_face_reference_blob(face: number): number;
	hb_set_add(set: number, codePoint: number): void;
	hb_subset_input_create_or_fail(): number;
	hb_subset_input_destroy(input: number): void;
	hb_subset_input_unicode_set(input: number): number;
	hb_subset_or_fail(face: number, input: number): number;
};

const fontBuffers = new Map<string, Promise<ArrayBuffer>>();
const subsetDataUrls = new Map<string, Promise<string>>();
let harfBuzzExports: Promise<HarfBuzzSubsetExports> | null = null;

/**
 * Charge le moteur HarfBuzz de sous-ensemble de polices.
 * @returns {Promise<HarfBuzzSubsetExports>} Exports WASM HarfBuzz.
 */
async function getHarfBuzzExports(): Promise<HarfBuzzSubsetExports> {
	harfBuzzExports ??= fetch(subsetWasmUrl)
		.then((response) => response.arrayBuffer())
		.then((wasm) => WebAssembly.instantiate(wasm))
		.then(({ instance }) => instance.exports as unknown as HarfBuzzSubsetExports);
	return harfBuzzExports;
}

/**
 * Convertit des octets de police en URL de données.
 * @param {Uint8Array} bytes Octets de la police réduite.
 * @returns {string} URL de données OpenType.
 */
function fontBytesToDataUrl(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return `data:font/otf;base64,${btoa(binary)}`;
}

/**
 * Crée une police autonome limitée aux caractères demandés.
 * @param {ArrayBuffer} fontBuffer Fichier OpenType ou collection source.
 * @param {number} fontIndex Index de la face dans une collection.
 * @param {string} text Caractères à conserver.
 * @returns {Promise<Uint8Array>} Police OpenType réduite.
 */
async function subsetFont(
	fontBuffer: ArrayBuffer,
	fontIndex: number,
	text: string
): Promise<Uint8Array> {
	const hb = await getHarfBuzzExports();
	const fontPointer = hb.malloc(fontBuffer.byteLength);
	let face = 0;
	let input = 0;
	let subset = 0;
	let resultBlob = 0;

	try {
		new Uint8Array(hb.memory.buffer).set(new Uint8Array(fontBuffer), fontPointer);
		const blob = hb.hb_blob_create(fontPointer, fontBuffer.byteLength, 2, 0, 0);
		face = hb.hb_face_create(blob, fontIndex);
		hb.hb_blob_destroy(blob);

		input = hb.hb_subset_input_create_or_fail();
		if (!input) throw new Error('Could not create HarfBuzz subset input');
		const unicodeSet = hb.hb_subset_input_unicode_set(input);
		for (const character of text) hb.hb_set_add(unicodeSet, character.codePointAt(0)!);

		subset = hb.hb_subset_or_fail(face, input);
		if (!subset) throw new Error('Could not subset system font');
		resultBlob = hb.hb_face_reference_blob(subset);
		const length = hb.hb_blob_get_length(resultBlob);
		const offset = hb.hb_blob_get_data(resultBlob, 0);
		if (!length) throw new Error('HarfBuzz returned an empty system font subset');
		return new Uint8Array(hb.memory.buffer, offset, length).slice();
	} finally {
		if (resultBlob) hb.hb_blob_destroy(resultBlob);
		if (subset) hb.hb_face_destroy(subset);
		if (input) hb.hb_subset_input_destroy(input);
		if (face) hb.hb_face_destroy(face);
		hb.free(fontPointer);
	}
}

/**
 * Retourne une URL de police réduite et la met en cache par fichier, face et caractères.
 * @param {string} fontUrl URL du fichier de police système.
 * @param {number} fontIndex Index de la face dans une collection.
 * @param {string} text Texte à rendre avec cette police.
 * @returns {Promise<string>} URL de données de la police réduite.
 */
export async function getSystemFontSubsetDataUrl(
	fontUrl: string,
	fontIndex: number,
	text: string
): Promise<string> {
	const characters = Array.from(new Set(text)).sort().join('');
	const cacheKey = `${fontUrl}|${fontIndex}|${characters}`;
	let subsetPromise = subsetDataUrls.get(cacheKey);
	if (!subsetPromise) {
		let fontPromise = fontBuffers.get(fontUrl);
		if (!fontPromise) {
			fontPromise = fetch(fontUrl).then((response) => {
				if (!response.ok) throw new Error(`Could not load system font: ${response.status}`);
				return response.arrayBuffer();
			});
			fontBuffers.set(fontUrl, fontPromise);
		}
		subsetPromise = fontPromise
			.then((fontBuffer) => subsetFont(fontBuffer, fontIndex, characters))
			.then(fontBytesToDataUrl);
		subsetDataUrls.set(cacheKey, subsetPromise);
	}
	return subsetPromise;
}
