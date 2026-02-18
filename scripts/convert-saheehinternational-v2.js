import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// download from https://qul.tarteel.ai/resources/translation
const DEFAULT_INPUT = 'en-sahih-international-chunks.json';
const DEFAULT_OUTPUT = path.join(
	__dirname,
	'..',
	'static',
	'translations',
	'en-saheehinternational-2',
	'saheehinternational-2.json'
);

function buildVerseText(parts) {
	if (!Array.isArray(parts)) return '';

	const text = parts
		.filter((part) => typeof part === 'string')
		.join('')
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.;:!?])/g, '$1')
		.trim();

	return text;
}

async function resolveInputFile(inputPath) {
	const stat = await fs.stat(inputPath);
	if (!stat.isDirectory()) return inputPath;

	return path.join(inputPath, 'en-sahih-international-chunks.json');
}

async function main() {
	const inputArg = process.argv[2];
	const outputArg = process.argv[3];

	const inputPath = await resolveInputFile(inputArg ?? DEFAULT_INPUT);
	const outputPath = outputArg ?? DEFAULT_OUTPUT;

	const rawText = await fs.readFile(inputPath, 'utf8');
	const rawData = JSON.parse(rawText);

	const verses = Object.entries(rawData)
		.map(([reference, value]) => {
			const [surah, ayah] = reference.split(':').map(Number);
			if (!Number.isInteger(surah) || !Number.isInteger(ayah)) return null;

			return {
				surah,
				ayah,
				verse: buildVerseText(value?.t)
			};
		})
		.filter(Boolean)
		.sort((a, b) => a.surah - b.surah || a.ayah - b.ayah);

	const out = {
		quran: {
			'en.sahih': {}
		}
	};

	for (let i = 0; i < verses.length; i++) {
		const id = i + 1;
		const verse = verses[i];

		out.quran['en.sahih'][String(id)] = {
			id,
			surah: verse.surah,
			ayah: verse.ayah,
			verse: verse.verse
		};
	}

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${JSON.stringify(out, null, '\t')}\n`, 'utf8');

	console.log(`Converted ${verses.length} verses.`);
	console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
