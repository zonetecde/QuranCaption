import { globalState } from '$lib/runes/main.svelte';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

type SystemFontSource = {
	family: string;
	sourceFamily: string;
	fullName: string;
	postscriptName: string | null;
	path: string;
	fontIndex: number;
	format: string | null;
	fontWeight: number;
	fontWeightRange: string | null;
	fontStyle: string;
};

export class QPCFontProvider {
	static qpc2Glyphs: Record<string, string> | undefined = undefined;
	static qpc1Glyphs: Record<string, string> | undefined = undefined;
	static verseMappingV2: Record<string, string> | undefined = undefined;
	static verseMappingV1: Record<string, string> | undefined = undefined;
	static loadedFonts: Set<string> = new Set();
	static fontLoadPromises: Map<string, Promise<void>> = new Map();
	static resolvedSystemFontFamilies: Set<string> = new Set();
	static registeredSystemFontFaces: Set<string> = new Set();
	private static readonly FONT_WAIT_TIMEOUT_MS = 1200;
	private static readonly TAJWEED_FONT_BASE_URL =
		'https://cdn.jsdelivr.net/gh/quran/quran.com-frontend-next/public/fonts/quran/hafs/v4/colrv1';

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
			// Pour l'export, seule la famille principale compte: les fallbacks système n'ont
			// pas besoin d'être sérialisés.
			const primaryFamily = familyValue.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
			if (
				!primaryFamily ||
				this.isGenericFontFamily(primaryFamily) ||
				!this.shouldWaitForFontFamily(primaryFamily)
			) {
				continue;
			}
			fontFamilies.add(primaryFamily);
		}

		if (fontFamilies.size === 0) return;

		await this.registerSystemFontFacesIfNeeded(Array.from(fontFamilies));
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

	static getTajweedFontNameForVerse(surah: number, verse: number): string {
		const verseKey = `${surah}:${verse}`;
		const mappedFontName = this.verseMappingV2![verseKey] || 'QPC2_p001';
		const pageNumber = this.extractPageNumberFromMappedFontName(mappedFontName);
		const fontName = `p${pageNumber}-v4`;

		this.loadTajweedFontIfNotLoaded(fontName, pageNumber);
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

	private static loadTajweedFontIfNotLoaded(fontName: string, pageNumber: number): Promise<void> {
		if (typeof document === 'undefined') return Promise.resolve();

		if (!this.loadedFonts.has(fontName)) {
			const style = document.createElement('style');
			const page = String(pageNumber);
			const woff2 = `${this.TAJWEED_FONT_BASE_URL}/woff2/p${page}.woff2`;
			const woff = `${this.TAJWEED_FONT_BASE_URL}/woff/p${page}.woff`;
			const ttf = `${this.TAJWEED_FONT_BASE_URL}/ttf/p${page}.ttf`;

			style.textContent = `
				@font-face {
					font-family: '${fontName}';
					src: url('${woff2}') format('woff2'),
						url('${woff}') format('woff'),
						url('${ttf}') format('truetype');
					font-weight: normal;
					font-style: normal;
				}
			`;
			document.head.appendChild(style);
			this.loadedFonts.add(fontName);
		}

		return this.waitForFontFamily(fontName);
	}

	private static extractPageNumberFromMappedFontName(fontName: string): number {
		const match = /_p(\d+)/i.exec(fontName);
		if (!match) return 1;
		const pageNumber = parseInt(match[1], 10);
		return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
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
					console.warn(`Timed out while waiting for font "${fontFamily}" before export capture.`);
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
		const normalized = fontFamily.trim().toLowerCase();
		if (!normalized) return false;
		if (normalized === 'inherit' || normalized === 'initial' || normalized === 'unset') return false;

		return true;
	}

	private static async registerSystemFontFacesIfNeeded(fontFamilies: string[]): Promise<void> {
		if (typeof document === 'undefined') return;

		const familiesToResolve = Array.from(new Set(fontFamilies)).filter((fontFamily) =>
			this.shouldResolveSystemFontFamily(fontFamily)
		);
		if (familiesToResolve.length === 0) return;

		for (const fontFamily of familiesToResolve) {
			this.resolvedSystemFontFamilies.add(fontFamily);
		}

		try {
			const sources = await invoke<SystemFontSource[]>('get_system_font_sources', {
				fontFamilies: familiesToResolve
			});

			for (const source of sources) {
				this.registerSystemFontFace(source);
			}
		} catch (error) {
			console.warn('Could not resolve system font files before export capture.', error);
		}
	}

	private static shouldResolveSystemFontFamily(fontFamily: string): boolean {
		if (!fontFamily) return false;
		if (this.loadedFonts.has(fontFamily)) return false;
		if (this.resolvedSystemFontFamilies.has(fontFamily)) return false;
		if (this.isGenericFontFamily(fontFamily)) return false;
		if (this.isAppProvidedFontFamily(fontFamily)) return false;
		return true;
	}

	private static registerSystemFontFace(source: SystemFontSource): void {
		if (typeof document === 'undefined') return;
		if (!source.family || !source.path) return;

		const key = [
			source.family,
			source.path,
			source.fontIndex,
			source.fontWeight,
			source.fontWeightRange ?? '',
			source.fontStyle
		].join('|');
		if (this.registeredSystemFontFaces.has(key)) return;

		const fontUrl = convertFileSrc(source.path);
		const format = source.format ? ` format("${this.escapeCssString(source.format)}")` : '';
		const fontWeight = this.normalizeCssFontWeight(source.fontWeight, source.fontWeightRange);
		const fontStyle = this.normalizeCssFontStyle(source.fontStyle);
		const style = document.createElement('style');

		style.textContent = `
			@font-face {
				font-family: "${this.escapeCssString(source.family)}";
				src: url("${this.escapeCssString(fontUrl)}")${format};
				font-weight: ${fontWeight};
				font-style: ${fontStyle};
			}
		`;
		document.head.appendChild(style);
		this.registeredSystemFontFaces.add(key);
	}

	private static isAppProvidedFontFamily(fontFamily: string): boolean {
		return (
			fontFamily === 'Hafs' ||
			fontFamily === 'IndoPak' ||
			fontFamily === 'Reciters' ||
			fontFamily === 'Surahs' ||
			fontFamily === 'QPC1BSML' ||
			fontFamily === 'QPC2BSML' ||
			fontFamily.startsWith('QPC1') ||
			fontFamily.startsWith('QPC2') ||
			/^p\d+-v4$/.test(fontFamily)
		);
	}

	private static normalizeCssFontWeight(fontWeight: number, fontWeightRange: string | null): string {
		if (fontWeightRange && /^\d+\s+\d+$/.test(fontWeightRange)) return fontWeightRange;
		if (!Number.isFinite(fontWeight)) return '400';
		return String(Math.max(1, Math.min(1000, Math.round(fontWeight))));
	}

	private static normalizeCssFontStyle(fontStyle: string): string {
		if (fontStyle === 'italic' || fontStyle === 'oblique') return fontStyle;
		return 'normal';
	}

	private static escapeCssString(value: string): string {
		return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
	}

	private static async waitWithTimeout(promise: Promise<unknown>): Promise<boolean> {
		const result = await Promise.race([
			promise.then(() => true).catch(() => false),
			new Promise<boolean>((resolve) => setTimeout(() => resolve(false), this.FONT_WAIT_TIMEOUT_MS))
		]);

		return result;
	}

	private static async waitForNextPaint(): Promise<void> {
		const rafOrTimeout = () => new Promise<void>(resolve => {
			let handled = false;
			const id = requestAnimationFrame(() => {
				if (!handled) { handled = true; resolve(); }
			});
			setTimeout(() => {
				if (!handled) { handled = true; cancelAnimationFrame(id); resolve(); }
			}, 50);
		});
		await rafOrTimeout();
		await rafOrTimeout();
	}
}

export default QPCFontProvider;
