import { Edition } from '$lib/classes';

export type ImportedTranslationTextFile = {
	name: string;
	content: string;
};

export type CustomTranslationImportOptions = {
	author: string;
	language: string;
	direction: 'ltr' | 'rtl';
	getVerseCount: (surah: number) => number;
	requiredSurahs?: number[];
};

export type CustomTranslationImportResult = {
	edition: Edition;
	translations: Record<string, string>;
	importedSurahs: number[];
};

function slugify(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[^\x00-\x7F]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

function basename(fileName: string): string {
	return fileName.split(/[/\\]/).pop() || fileName;
}

export function extractSurahNumberFromFileName(fileName: string): number | null {
	const rawBaseName = basename(fileName);
	const baseNameWithoutExtension = rawBaseName.replace(/\.[^.]+$/, '');
	const tokens = baseNameWithoutExtension
		.split(/\D+/)
		.filter(Boolean)
		.map((token) => Number.parseInt(token, 10))
		.filter((value) => Number.isInteger(value) && value >= 1 && value <= 114);

	if (tokens.length === 0) return null;

	return tokens[tokens.length - 1];
}

function splitAyahLines(content: string): string[] {
	const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const lines = normalized.split('\n');

	while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
		lines.pop();
	}

	return lines.map((line) => line.trim());
}

function uniqueSortedNumbers(values: number[]): number[] {
	return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function buildCustomTranslationImport(
	files: ImportedTranslationTextFile[],
	options: CustomTranslationImportOptions
): CustomTranslationImportResult {
	const author = options.author.trim();
	const language = options.language.trim();

	if (author.length === 0) {
		throw new Error('Please enter a translation name.');
	}

	if (language.length === 0) {
		throw new Error('Please enter a language name.');
	}

	if (files.length === 0) {
		throw new Error('Please select at least one surah text file.');
	}

	const translations: Record<string, string> = {};
	const importedSurahs = new Set<number>();

	for (const file of files) {
		const surah = extractSurahNumberFromFileName(file.name);
		if (!surah) {
			throw new Error(
				`Could not detect a surah number from "${basename(file.name)}". Name files like 1.txt or 001.txt.`
			);
		}

		if (importedSurahs.has(surah)) {
			throw new Error(`Surah ${surah} was provided more than once.`);
		}

		const ayahLines = splitAyahLines(file.content);
		const expectedAyahCount = options.getVerseCount(surah);

		if (expectedAyahCount <= 0) {
			throw new Error(`Surah ${surah} is not recognized by the Quran metadata.`);
		}

		if (ayahLines.length !== expectedAyahCount) {
			throw new Error(
				`Surah ${surah} has ${ayahLines.length} lines, but ${expectedAyahCount} ayahs are expected.`
			);
		}

		for (let ayah = 1; ayah <= ayahLines.length; ayah += 1) {
			translations[`${surah}:${ayah}`] = ayahLines[ayah - 1];
		}

		importedSurahs.add(surah);
	}

	const requiredSurahs = uniqueSortedNumbers(options.requiredSurahs || []);
	const missingRequiredSurahs = requiredSurahs.filter((surah) => !importedSurahs.has(surah));
	if (missingRequiredSurahs.length > 0) {
		throw new Error(
			`Missing required surah files for this project: ${missingRequiredSurahs.join(', ')}.`
		);
	}

	const slugBase = `${slugify(language) || 'language'}-${slugify(author) || 'translation'}`;
	const uniqueSuffix = Date.now().toString(36);
	const editionId = `custom-${slugBase}-${uniqueSuffix}`;

	return {
		edition: new Edition(
			editionId,
			editionId,
			author,
			language,
			options.direction,
			'Imported text files',
			'Imported custom translation',
			'',
			'',
			true,
			'',
			true
		),
		translations,
		importedSurahs: Array.from(importedSurahs).sort((a, b) => a - b)
	};
}
