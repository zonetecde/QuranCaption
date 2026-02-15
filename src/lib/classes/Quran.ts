export class Word {
	arabic: string;
	transliteration: string;
	translation: string;

	constructor(arabic: string, transliteration: string, translation: string) {
		this.arabic = arabic;
		this.transliteration = transliteration;
		this.translation = translation;
	}

	static fromJson(data: any): Word {
		return new Word(data.c, data.d, data.e);
	}
}

export class Verse {
	id: number;
	words: Word[];

	constructor(id: number, words: Word[] = []) {
		this.id = id;
		this.words = words;
	}

	static fromJson(id: string, data: any): Verse {
		const words = data.w.map((word: any) => Word.fromJson(word));
		return new Verse(parseInt(id), words);
	}

	getArabicTextBetweenTwoIndexes(startIndex: number, endIndex: number): string {
		if (startIndex < 0 || endIndex >= this.words.length || startIndex > endIndex) {
			if (endIndex >= this.words.length) {
				return this.getArabicTextBetweenTwoIndexes(startIndex, this.words.length - 1);
			} else {
				throw new Error('Invalid index range');
			}
		}
		return this.words
			.slice(startIndex, endIndex + 1)
			.map((word) => word.arabic)
			.join(' ');
	}

	getWordByWordTranslationBetweenTwoIndexes(startIndex: number, endIndex: number): string[] {
		if (startIndex < 0 || endIndex >= this.words.length || startIndex > endIndex) {
			if (endIndex >= this.words.length) {
				return this.getWordByWordTranslationBetweenTwoIndexes(startIndex, this.words.length - 1);
			} else {
				throw new Error('Invalid index range');
			}
		}
		return this.words.slice(startIndex, endIndex + 1).map((word) => word.translation);
	}

	getNextPunctuationMarkIndex(index: number): number {
		// Retourne l'indice du prochain mot dans le verset contenant une de ces poncutations:
		const signesPonctuation = [
			'۩', // Sajda
			'ۖ', // Sakt
			'ۗ', // Qila
			'ۘ', // Mustahabb
			'ۙ', // Mujawwaz
			'ۚ', // Hasanu
			'ۛ', // Ahsanu
			'ۜ' // waqf
		];

		for (let i = index + 1; i < this.words.length; i++) {
			for (const signe of signesPonctuation) {
				if (this.words[i].arabic.includes(signe)) {
					return i; // Retourne l'indice du mot contenant la ponctuation
				}
			}
		}

		return this.words.length - 1;
	}

	getPreviousPunctuationMarkIndex(startWordIndex: number): number {
		// Retourne l'indice du mot précédent dans le verset contenant une de ces poncutations:
		const signesPonctuation = [
			'۩', // Sajda
			'ۖ', // Sakt
			'ۗ', // Qila
			'ۘ', // Mustahabb
			'ۙ', // Mujawwaz
			'ۚ', // Hasanu
			'ۛ', // Ahsanu
			'ۜ' // waqf
		];

		const hasPunctuation = (wordIndex: number) => {
			if (wordIndex < 0 || wordIndex >= this.words.length) return false;
			return signesPonctuation.some((signe) => this.words[wordIndex].arabic.includes(signe));
		};

		let searchIndex = Math.min(startWordIndex, this.words.length - 1);

		// Si on est deja sur un signe d'arret, on le saute pour trouver le precedent
		if (hasPunctuation(searchIndex)) {
			searchIndex--;
		}

		for (let i = searchIndex; i >= 0; i--) {
			if (hasPunctuation(i)) {
				return i;
			}
		}

		return 0;
	}
}

export class Surah {
	id: number;
	arabic: string;
	name: string;
	translation: string;
	totalAyah: number;
	verses: Verse[];
	arabicLong: string;
	revelationPlace: string;

	constructor(
		id: number,
		arabic: string,
		name: string,
		translation: string,
		totalAyah: number,
		arabicLong: string,
		revelationPlace: string,
		verses: Verse[] = []
	) {
		this.id = id;
		this.arabic = arabic;
		this.name = name;
		this.translation = translation;
		this.totalAyah = totalAyah;
		this.arabicLong = arabicLong;
		this.revelationPlace = revelationPlace;
		this.verses = verses;
	}

	static fromJson(data: any): Surah {
		return new Surah(
			data.id,
			data.arabic,
			data.name,
			data.translation,
			data.totalAyah,
			data.arabicLong,
			data.revelationPlace,
			[] // verses will be loaded later
		);
	}
}

export class Quran {
	static surahs: Surah[] = [];

	/**
	 * Charge le Coran depuis le fichier JSON (singleton)
	 */
	static async load() {
		if (Quran.surahs.length > 0) {
			return; // Le Coran est déjà chargé
		}
		const response = await fetch('/quran/surahs.json');
		const data: any[] = await response.json();

		this.surahs = data.map((surahData) => Surah.fromJson(surahData));
	}

	/**
	 * Obtient toutes les sourates
	 */
	static getSurahs(): Surah[] {
		return Quran.surahs;
	}

	static getVerseCount(surah: number): number {
		const foundSurah = Quran.surahs.find((s) => s.id === surah);
		return foundSurah ? foundSurah.totalAyah : 0;
	}

	static getSurahsNames(): { id: number; transliteration: string }[] {
		return Quran.surahs.map((surah) => ({
			id: surah.id,
			transliteration: surah.name
		}));
	}

	/**
	 * Obtient une sourate par son ID
	 */
	static async getSurah(id: number): Promise<Surah> {
		const surah = Quran.surahs.find((surah) => surah.id === id)!;
		if (surah.verses.length === 0) {
			// Charge la sourate depuis le fichier JSON
			const response = await fetch(`/quran/${id}.json`);
			const data = await response.json();
			const verses: Verse[] = Object.entries(data).map(([verseId, verseData]: [string, any]) =>
				Verse.fromJson(verseId, verseData)
			);
			surah.verses = verses;
		}

		return surah;
	}

	/**
	 * Obtient un verset spécifique
	 */
	static async getVerse(surahId: number, verseId: number): Promise<Verse | undefined> {
		const surah = await Quran.getSurah(surahId);
		return surah.verses.find((verse) => verse.id === verseId);
	}
}
