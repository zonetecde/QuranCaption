import { globalState } from '$lib/runes/main.svelte';

export class QPCFontProvider {
	static qpc2Glyphs: Record<string, string> | undefined = undefined;
	static qpc1Glyphs: Record<string, string> | undefined = undefined;
	static verseMappingV2: Record<string, string> | undefined = undefined;
	static verseMappingV1: Record<string, string> | undefined = undefined;
	static loadedFonts: Set<string> = new Set();

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
	static loadFontIfNotLoaded(fontName: string, version: '1' | '2') {
		// Vérifie si la police est déjà chargée
		if (this.loadedFonts.has(fontName)) {
			return;
		}

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
}

export default QPCFontProvider;
