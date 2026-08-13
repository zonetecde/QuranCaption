import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WARSH_DATA_URL =
	'https://raw.githubusercontent.com/thetruetruth/quran-data-kfgqpc/main/warsh/data/warshData_v10.json';
const WARSH_TTF_URL =
	'https://cdn.jsdelivr.net/gh/thetruetruth/quran-data-kfgqpc@main/warsh/font/warsh.10.ttf';
const WARSH_WOFF2_URL =
	'https://cdn.jsdelivr.net/gh/thetruetruth/quran-data-kfgqpc@main/warsh/font/warsh.10.woff2';

const mappingPath = process.argv[2];
if (!mappingPath) {
	throw new Error('Usage: node scripts/sync-warsh-quran.js <hafs-warsh-ayah-map.json>');
}

const outputDirectory = path.resolve('static/warsh');

/**
 * Télécharge une ressource binaire ou textuelle.
 * @param {string} url URL source.
 * @returns {Promise<Buffer>} Contenu téléchargé.
 */
async function download(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

/**
 * Normalise un mot arabe pour comparer les lectures sans dépendre des signes typographiques.
 * @param {string} value Mot à normaliser.
 * @returns {string} Forme arabe comparable.
 */
function normalizeArabic(value) {
	return value
		.normalize('NFD')
		.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08FF]/g, '')
		.replace(/ـ/g, '')
		.replace(/[ٱإأآ]/g, 'ا')
		.replace(/[ىیے]/g, 'ي')
		.replace(/ؤ/g, 'و')
		.replace(/ئ/g, 'ي')
		.replace(/[^ء-غف-ي]/g, '');
}

/**
 * Calcule la distance de Levenshtein entre deux chaînes.
 * @param {string} left Première chaîne.
 * @param {string} right Seconde chaîne.
 * @returns {number} Nombre minimal d'éditions.
 */
function levenshtein(left, right) {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length];
}

/**
 * Évalue une correspondance locale entre un à trois mots Hafs et Warsh.
 * @param {Array<{ text: string }>} hafsWords Mots Hafs.
 * @param {Array<{ text: string }>} warshWords Mots Warsh.
 * @returns {number} Coût d'alignement.
 */
function getGroupCost(hafsWords, warshWords) {
	const hafs = normalizeArabic(hafsWords.map((word) => word.text).join(''));
	const warsh = normalizeArabic(warshWords.map((word) => word.text).join(''));
	const length = Math.max(hafs.length, warsh.length, 1);
	return (
		(levenshtein(hafs, warsh) / length) * Math.max(hafsWords.length, warshWords.length) +
		0.1 * (hafsWords.length + warshWords.length - 2)
	);
}

/**
 * Aligne les mots d'un composant d'āyāt en autorisant les ajouts, omissions, fusions et scissions.
 * @param {Array<{ text: string, verse: number, index: number }>} hafsWords Mots Hafs ordonnés.
 * @param {Array<{ text: string, verse: number, index: number, verseEnd?: number }>} warshWords Mots Warsh ordonnés.
 * @returns {Array<{ hafsStart: number, hafsCount: number, warshStart: number, warshCount: number }>} Opérations d'alignement.
 */
function alignWords(hafsWords, warshWords) {
	const rows = hafsWords.length + 1;
	const columns = warshWords.length + 1;
	const costs = Array.from({ length: rows }, () => Array(columns).fill(Number.POSITIVE_INFINITY));
	const previous = Array.from({ length: rows }, () => Array(columns).fill(null));
	costs[0][0] = 0;

	for (let hafsIndex = 0; hafsIndex <= hafsWords.length; hafsIndex++) {
		for (let warshIndex = 0; warshIndex <= warshWords.length; warshIndex++) {
			const currentCost = costs[hafsIndex][warshIndex];
			if (!Number.isFinite(currentCost)) continue;

			const transitions = [];
			if (hafsIndex < hafsWords.length) transitions.push([1, 0, 1]);
			if (warshIndex < warshWords.length) transitions.push([0, 1, 1]);
			for (
				let hafsCount = 1;
				hafsCount <= 3 && hafsIndex + hafsCount <= hafsWords.length;
				hafsCount++
			) {
				for (
					let warshCount = 1;
					warshCount <= 3 && warshIndex + warshCount <= warshWords.length;
					warshCount++
				) {
					transitions.push([
						hafsCount,
						warshCount,
						getGroupCost(
							hafsWords.slice(hafsIndex, hafsIndex + hafsCount),
							warshWords.slice(warshIndex, warshIndex + warshCount)
						)
					]);
				}
			}

			for (const [hafsCount, warshCount, transitionCost] of transitions) {
				const nextHafsIndex = hafsIndex + hafsCount;
				const nextWarshIndex = warshIndex + warshCount;
				const nextCost = currentCost + transitionCost;
				if (nextCost >= costs[nextHafsIndex][nextWarshIndex]) continue;
				costs[nextHafsIndex][nextWarshIndex] = nextCost;
				previous[nextHafsIndex][nextWarshIndex] = {
					hafsIndex,
					warshIndex,
					hafsCount,
					warshCount
				};
			}
		}
	}

	const operations = [];
	let hafsIndex = hafsWords.length;
	let warshIndex = warshWords.length;
	while (hafsIndex > 0 || warshIndex > 0) {
		const operation = previous[hafsIndex][warshIndex];
		if (!operation) throw new Error('Unable to align a Hafs/Warsh word component.');
		operations.push({
			hafsStart: operation.hafsIndex,
			hafsCount: operation.hafsCount,
			warshStart: operation.warshIndex,
			warshCount: operation.warshCount
		});
		hafsIndex = operation.hafsIndex;
		warshIndex = operation.warshIndex;
	}
	return operations.reverse();
}

/**
 * Retire le numéro final tout en conservant le texte Unicode KFGQPC Warsh.
 * @param {string} text Texte brut d'une āyah.
 * @returns {string} Texte sans numéro final.
 */
function stripWarshAyahNumber(text) {
	return text.replace(/[\u00A0\s]+[٠-٩]+\s*$/u, '').trim();
}

/**
 * Découpe une āyah Warsh en rattachant les symboles de juz/hizb au mot suivant.
 * @param {string} text Texte d'āyah sans numéro final.
 * @returns {string[]} Mots compatibles avec le rendu et l'alignement.
 */
function tokenizeWarshText(text) {
	const words = [];
	let prefix = '';
	for (const token of text.split(/\s+/u).filter(Boolean)) {
		if (!/[ء-غف-ي]/u.test(normalizeArabic(token))) {
			prefix += token;
			continue;
		}
		words.push(prefix + token);
		prefix = '';
	}
	if (prefix && words.length > 0) words[words.length - 1] += prefix;
	return words;
}

/**
 * Construit les composantes connexes Hafs/Warsh d'une sourate.
 * @param {Record<string, { targets: number[] }>} surahMapping Mapping direct d'une sourate.
 * @returns {Array<{ hafs: number[], warsh: number[] }>} Composantes ordonnées.
 */
function getMappingComponents(surahMapping) {
	const remaining = new Set(Object.keys(surahMapping).map(Number));
	const components = [];
	while (remaining.size > 0) {
		const first = Math.min(...remaining);
		const hafs = new Set([first]);
		const warsh = new Set(surahMapping[first].targets);
		let changed = true;
		while (changed) {
			changed = false;
			for (const candidate of remaining) {
				if (hafs.has(candidate)) continue;
				const targets = surahMapping[candidate].targets;
				if (!targets.some((target) => warsh.has(target))) continue;
				hafs.add(candidate);
				for (const target of targets) warsh.add(target);
				changed = true;
			}
		}
		for (const verse of hafs) remaining.delete(verse);
		components.push({
			hafs: [...hafs].sort((a, b) => a - b),
			warsh: [...warsh].sort((a, b) => a - b)
		});
	}
	return components;
}

/**
 * Sélectionne le mot Hafs propriétaire d'un mot Warsh aligné.
 * @param {Array<{ text: string, verse: number, index: number }>} candidates Mots Hafs candidats.
 * @param {{ text: string }} warshWord Mot Warsh.
 * @returns {{ text: string, verse: number, index: number }} Propriétaire le plus proche lexicalement.
 */
function selectOwner(candidates, warshWord) {
	return candidates.reduce((best, candidate) => {
		const bestCost = getGroupCost([best], [warshWord]);
		const candidateCost = getGroupCost([candidate], [warshWord]);
		return candidateCost < bestCost ? candidate : best;
	});
}

const mapping = JSON.parse(await readFile(path.resolve(mappingPath), 'utf8'));
const warshSource = JSON.parse((await download(WARSH_DATA_URL)).toString('utf8'));
const warshByKey = Object.fromEntries(
	warshSource.map((ayah) => [`${ayah.sura_no}:${ayah.aya_no}`, stripWarshAyahNumber(ayah.aya_text)])
);
const verses = {};

for (let surah = 1; surah <= 114; surah++) {
	const hafsSurah = JSON.parse(await readFile(path.resolve(`static/quran/${surah}.json`), 'utf8'));
	const surahMapping = mapping.hafs_to_warsh[String(surah)];
	for (const verse of Object.keys(surahMapping)) verses[`${surah}:${verse}`] = { words: [] };

	for (const component of getMappingComponents(surahMapping)) {
		if (surah === 1 && component.hafs.length === 1 && component.hafs[0] === 1) {
			const basmala = stripWarshAyahNumber(warshByKey['27:30']).match(/بِسْمِ.+اِ۬لرَّحِيمِ/u)?.[0];
			if (!basmala) throw new Error('Unable to derive the Warsh basmala from 27:30.');
			const hafsWords = hafsSurah['1'].w.map((word, index) => ({ text: word.c, verse: 1, index }));
			const warshWords = tokenizeWarshText(basmala).map((text, index) => ({
				text,
				verse: 0,
				index
			}));
			for (const operation of alignWords(hafsWords, warshWords)) {
				const sources = hafsWords.slice(
					operation.hafsStart,
					operation.hafsStart + operation.hafsCount
				);
				for (const word of warshWords.slice(
					operation.warshStart,
					operation.warshStart + operation.warshCount
				)) {
					const owner = sources.length > 0 ? selectOwner(sources, word) : hafsWords[0];
					verses['1:1'].words.push({
						text: word.text,
						owner: owner.index,
						source: sources.map((source) => source.index)
					});
				}
			}
			continue;
		}

		const hafsWords = component.hafs.flatMap((verse) =>
			hafsSurah[String(verse)].w.map((word, index) => ({ text: word.c, verse, index }))
		);
		const warshWords = component.warsh.flatMap((verse) => {
			const words = tokenizeWarshText(warshByKey[`${surah}:${verse}`]);
			return words.map((text, index) => ({
				text,
				verse,
				index,
				...(index === words.length - 1 ? { verseEnd: verse } : {})
			}));
		});

		let lastOwner = hafsWords[0];
		for (const operation of alignWords(hafsWords, warshWords)) {
			const sources = hafsWords.slice(
				operation.hafsStart,
				operation.hafsStart + operation.hafsCount
			);
			const targets = warshWords.slice(
				operation.warshStart,
				operation.warshStart + operation.warshCount
			);
			for (const word of targets) {
				const nextSource = hafsWords[operation.hafsStart + operation.hafsCount];
				const owner = sources.length > 0 ? selectOwner(sources, word) : (lastOwner ?? nextSource);
				if (!owner)
					throw new Error(`Unable to own Warsh word ${surah}:${word.verse}:${word.index}.`);
				lastOwner = owner;
				verses[`${surah}:${owner.verse}`].words.push({
					text: word.text,
					owner: owner.index,
					source: sources
						.filter((source) => source.verse === owner.verse)
						.map((source) => source.index),
					...(word.verseEnd ? { verseEnd: word.verseEnd } : {})
				});
			}
		}
	}
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(
	path.join(outputDirectory, 'verses.json'),
	JSON.stringify({
		_meta: {
			source: WARSH_DATA_URL,
			warshAyahCount: warshSource.length,
			hafsAyahCount: Object.keys(verses).length
		},
		verses
	})
);
await copyFile(path.resolve(mappingPath), path.join(outputDirectory, 'ayah-map.json'));
await writeFile(path.join(outputDirectory, 'warsh.10.ttf'), await download(WARSH_TTF_URL));
await writeFile(path.join(outputDirectory, 'warsh.10.woff2'), await download(WARSH_WOFF2_URL));

console.log(
	`Generated ${Object.keys(verses).length} Hafs-indexed Warsh entries in ${outputDirectory}.`
);
