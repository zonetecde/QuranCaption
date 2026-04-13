import { globalState } from '$lib/runes/main.svelte';

export class QPCFontProvider {
	static qpc2Glyphs: Record<string, string> | undefined = undefined;
	static qpc1Glyphs: Record<string, string> | undefined = undefined;
	static verseMappingV2: Record<string, string> | undefined = undefined;
	static verseMappingV1: Record<string, string> | undefined = undefined;
	static loadedFonts: Set<string> = new Set();
	static fontLoadPromises: Map<string, Promise<void>> = new Map();
	private static readonly FONT_WAIT_TIMEOUT_MS = 1200;

	static async loadQPC2Data() {
		if (!QPCFontProvider.qpc2Glyphs) {
			QPCFontProvider.qpc2Glyphs = await (await fetch('/QPC2/qpc-v2.json')).json();
		}
		if (!QPCFontProvider.qpc1Glyphs) {
			QPCFontProvider.qpc1Glyphs = await (await fetch('/QPC1/qpc-v1.json')).json();
		}

		if (!QPCFontProvider.verseMappingV2) {
			// verse-mapping by Primo - May Allah reward him for his work
			QPCFontProvider.verseMappingV2 = await (await fetch('/QPC2/verse-mapping.json')).json();
		}
		if (!QPCFontProvider.verseMappingV1) {
			// verse-mapping by Primo - May Allah reward him for his work
			QPCFontProvider.verseMappingV1 = await (await fetch('/QPC1/verse-mapping.json')).json();
		}

		// Charge déjà le fichier font avec la basmala
		QPCFontProvider.loadFontIfNotLoaded('QPC1BSML', '1');
		QPCFontProvider.loadFontIfNotLoaded('QPC2BSML', '2');
	}

	/**
	 * Charge dynamiquement une police QCP si elle n'est pas déjà chargée
	 */
	static loadFontIfNotLoaded(fontName: string, version: '1' | '2'): Promise<void> {
		if (typeof document === 'undefined') return Promise.resolve();
		// Vérifie si la police est déjà chargée

		if (!this.loadedFonts.has(fontName)) {
			// Crée une nouvelle règle @font-face
			const style = document.createElement('style');

			// Les polices contenant les basmala/isti3adha sont au format ttf
			const extension = fontName.includes('BSML') ? 'ttf' : 'woff2';
			const format = fontName.includes('BSML') ? 'truetype' : 'woff2';

			style.textContent = `
				@font-face {
					font-family: '${fontName}';
					src: url('/QPC${version}/fonts/${fontName}.${extension}') format('${format}');
					font-weight: normal;
					font-style: normal;
				}
			`;
			document.head.appendChild(style);
			// Marque la police comme chargée
			this.loadedFonts.add(fontName);
		}

		return this.waitForFontFamily(fontName);
	}

	static async waitForFontsInElement(element: Element | null | undefined): Promise<void> {
		if (!element || typeof document === 'undefined' || !('fonts' in document)) return;

		const fontFamilies = new Set<string>();
		const nodes = [element, ...Array.from(element.querySelectorAll('*'))];

		for (const node of nodes) {
			const familyValue = window.getComputedStyle(node).fontFamily;
			for (const family of familyValue.split(',')) {
				const trimmed = family.trim().replace(/^['"]|['"]$/g, '');
				if (!trimmed || this.isGenericFontFamily(trimmed) || !this.shouldWaitForFontFamily(trimmed))
					continue;
				fontFamilies.add(trimmed);
			}
		}

		if (fontFamilies.size === 0) return;

		await Promise.all(
			Array.from(fontFamilies).map((fontFamily) => this.waitForFontFamily(fontFamily))
		);
		await this.waitForNextPaint();
	}

	static getFontNameForVerse(surah: number, verse: number, qpcVersion: '1' | '2'): string {
		// Get the font name for the verse
		const verseKey = `${surah}:${verse}`;

		const fontName =
			qpcVersion === '1'
				? this.verseMappingV1![verseKey] || 'QPC1_p0001'
				: this.verseMappingV2![verseKey] || 'QPC2_p0001';

		// Charge dynamiquement la police si elle n'est pas déjà chargée
		QPCFontProvider.loadFontIfNotLoaded(fontName, qpcVersion);

		return fontName;
	}

	static getQuranVerseGlyph(
		surah: number,
		verse: number,
		startWord: number,
		endWord: number,
		isLastWords: boolean,
		qpcVersion: '1' | '2' = '2'
	): string {
		let str = '';
		for (let i = startWord + 1; i <= endWord + 1; i++) {
			const key = `${surah}:${verse}:${i}`;
			const glyph =
				qpcVersion === '1' ? QPCFontProvider.qpc1Glyphs![key] : QPCFontProvider.qpc2Glyphs![key];
			if (glyph) {
				str += glyph + ' ';
			}
		}

		// Si on veut inclure le numéro de verset
		if (isLastWords && globalState.getStyle('arabic', 'show-verse-number')!.value) {
			const key = `${surah}:${verse}:${endWord + 2}`;
			const glyph =
				qpcVersion === '1' ? QPCFontProvider.qpc1Glyphs![key] : QPCFontProvider.qpc2Glyphs![key];
			if (glyph) {
				str += glyph; // Ajoute le symbole du numéro de verset
			}
		}

		return str.trim();
	}

	static getBasmalaGlyph(version: '1' | '2'): string {
		switch (version) {
			case '1':
				return '#"!'; // ou alors peut-être -,+*
			case '2':
				return 'ﭑﭒﭓ';
			default:
				return '';
		}
	}

	static getIstiadhahGlyph(version: '1' | '2'): string {
		switch (version) {
			case '1':
				return 'FEDCB'.split('').join(' ');
			case '2':
				return 'ﭲﭳﭴﭵﭶ'.split('').join(' ');
			default:
				return '';
		}
	}

	static getSadaqaGlyph(): string {
		return 'A@ ?';
	}

	/**
	 * Attends une police spécifique dans le document.
	 * @param fontFamily Le nom de la police à attendre.
	 * @returns Une promesse qui se résout lorsque la police est chargée.
	 */
	private static waitForFontFamily(fontFamily: string): Promise<void> {
		if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
		if (this.isGenericFontFamily(fontFamily)) return Promise.resolve();

		const existingPromise = this.fontLoadPromises.get(fontFamily);
		if (existingPromise) return existingPromise;

		const escapedFontFamily = fontFamily.replace(/(["\\])/g, '\\$1');
		const fontSpec = `normal 32px "${escapedFontFamily}"`;

		const loadPromise = (async () => {
			if (document.fonts.check(fontSpec)) return;
			try {
				const didLoad = await this.waitWithTimeout(document.fonts.load(fontSpec));
				if (!didLoad) {
					console.warn(
						`Timed out while waiting for font "${fontFamily}" before export capture.`
					);
				}
			} catch (error) {
				console.warn(`Could not finish loading font "${fontFamily}" before capture.`, error);
			}
		})();

		this.fontLoadPromises.set(fontFamily, loadPromise);
		return loadPromise;
	}

	private static isGenericFontFamily(fontFamily: string): boolean {
		return (
			fontFamily === 'serif' ||
			fontFamily === 'sans-serif' ||
			fontFamily === 'monospace' ||
			fontFamily === 'cursive' ||
			fontFamily === 'fantasy' ||
			fontFamily === 'system-ui' ||
			fontFamily === 'emoji' ||
			fontFamily === 'math' ||
			fontFamily === 'fangsong' ||
			fontFamily === 'ui-serif' ||
			fontFamily === 'ui-sans-serif' ||
			fontFamily === 'ui-monospace' ||
			fontFamily === 'ui-rounded'
		);
	}

	private static shouldWaitForFontFamily(fontFamily: string): boolean {
		return (
			this.loadedFonts.has(fontFamily) ||
			fontFamily === 'Hafs' ||
			fontFamily === 'IndoPak' ||
			fontFamily === 'Reciters' ||
			fontFamily === 'Surahs' ||
			fontFamily === 'QPC1BSML' ||
			fontFamily === 'QPC2BSML' ||
			fontFamily.startsWith('QPC1') ||
			fontFamily.startsWith('QPC2')
		);
	}

	private static async waitWithTimeout(promise: Promise<unknown>): Promise<boolean> {
		const result = await Promise.race([
			promise.then(() => true).catch(() => false),
			new Promise<boolean>((resolve) =>
				setTimeout(() => resolve(false), this.FONT_WAIT_TIMEOUT_MS)
			)
		]);

		return result;
	}

	private static async waitForNextPaint(): Promise<void> {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	}
}

export default QPCFontProvider;
