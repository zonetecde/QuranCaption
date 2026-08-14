import fs from 'fs/promises';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
const API_URL = 'https://alquranmalayalam.net/alquran-api';
const TEMPLATE_DIR = path.join(__dirname, '..', 'static', 'translations', 'it');
const OUTPUT_DIR = path.join(__dirname, '..', 'static', 'translations', 'mal-quranlalithasaram');
const TRANSLATOR = 'Muhammad Karakunnu And Vanidas Elayavoor';
const PAGE_SIZE = 10;
const BATCH_SIZE = 5;

/**
 * Charge une réponse JSON avec quelques nouvelles tentatives en cas d'erreur temporaire.
 * @param {string} url URL à charger.
 * @returns {Promise<unknown>} Contenu JSON de la réponse.
 */
async function fetchJson(url) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		const response = await fetch(url);
		if (response.ok) return response.json();
		if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
	}
	throw new Error(`Impossible de charger ${url}`);
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const surahs = await fetchJson(`${API_URL}/suranames/all`);

for (const surah of surahs) {
	const pageCount = Math.ceil(surah.TotalLines / PAGE_SIZE);
	const lines = [];
	for (let page = 0; page < pageCount; page += BATCH_SIZE) {
		const batch = await Promise.all(
			Array.from({ length: Math.min(BATCH_SIZE, pageCount - page) }, (_, index) =>
				fetchJson(`${API_URL}/linetrans/${surah.SuraId}/${page + index}`)
			)
		);
		lines.push(...batch.flat());
	}
	const verses = new Map();
	for (const line of lines) {
		const previous = verses.get(line.AyaNo);
		verses.set(line.AyaNo, previous ? `${previous} ${line.MalTran}` : line.MalTran);
	}

	if (verses.size !== surah.TotalAyas) {
		throw new Error(
			`Sourate ${surah.SuraId}: ${verses.size} versets reçus au lieu de ${surah.TotalAyas}`
		);
	}

	const template = JSON.parse(
		await fs.readFile(path.join(TEMPLATE_DIR, `${surah.SuraId}.json`), 'utf8')
	);
	const metadata = { ...template[0], translator: TRANSLATOR };
	const translation = [
		metadata,
		...Array.from({ length: surah.TotalAyas }, (_, index) => [index + 1, verses.get(index + 1)])
	];

	await fs.writeFile(
		path.join(OUTPUT_DIR, `${surah.SuraId}.json`),
		JSON.stringify(translation, null, 2),
		'utf8'
	);
	console.log(`Sourate ${surah.SuraId} sauvegardée (${surah.TotalAyas} versets)`);
}
