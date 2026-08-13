import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPOSITORY_URL = 'https://raw.githubusercontent.com/thetruetruth/quran-data-kfgqpc/main';
const CDN_URL = 'https://cdn.jsdelivr.net/gh/thetruetruth/quran-data-kfgqpc@main';
const HAFS_DATA_URL = `${REPOSITORY_URL}/hafs/data/hafsData_v18.json`;
const mappingsOnly = process.argv.includes('--mappings-only');
const selectedSlug = process.argv
	.find((argument) => argument.startsWith('--riwayah='))
	?.split('=')[1];
const RIWAYAT = [
	{
		name: 'Warsh',
		slug: 'warsh',
		data: 'warsh/data/warshData_v10.json',
		font: 'warsh/font/warsh.10'
	},
	{
		name: 'Qaloon',
		slug: 'qaloon',
		data: 'qaloon/data/QaloonData_v10.json',
		font: 'qaloon/font/qaloon.10'
	},
	{
		name: 'Shouba',
		slug: 'shouba',
		data: 'shouba/data/ShoubaData08.json',
		font: 'shouba/font/shouba.8'
	},
	{
		name: 'Doori',
		slug: 'doori',
		data: 'doori/data/DooriData_v09.json',
		font: 'doori/font/doori.9'
	},
	{ name: 'Soosi', slug: 'soosi', data: 'soosi/data/SoosiData09.json', font: 'soosi/font/soosi.9' },
	{
		name: 'Bazzi',
		slug: 'bazzi',
		data: 'bazzi/data/BazziData_v07.json',
		font: 'bazzi/font/bazzi.7'
	},
	{
		name: 'Qumbul',
		slug: 'qumbul',
		data: 'qumbul/data/QumbulData_v07.json',
		font: 'qumbul/font/qumbul.7'
	}
];

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
 * Évalue une correspondance locale entre des groupes de mots ou d'āyāt.
 * @param {Array<{ text: string }>} hafsItems Éléments Hafs.
 * @param {Array<{ text: string }>} riwayahItems Éléments de la riwāyah.
 * @returns {number} Coût d'alignement.
 */
function getGroupCost(hafsItems, riwayahItems) {
	const hafs = hafsItems.map((item) => (item.normalized ??= normalizeArabic(item.text))).join('');
	const riwayah = riwayahItems
		.map((item) => (item.normalized ??= normalizeArabic(item.text)))
		.join('');
	const length = Math.max(hafs.length, riwayah.length, 1);
	return (
		(levenshtein(hafs, riwayah) / length) * Math.max(hafsItems.length, riwayahItems.length) +
		0.1 * (hafsItems.length + riwayahItems.length - 2)
	);
}

/**
 * Aligne des séquences en autorisant les ajouts, omissions, fusions et scissions.
 * @param {Array<{ text: string }>} hafsItems Éléments Hafs ordonnés.
 * @param {Array<{ text: string }>} riwayahItems Éléments de la riwāyah ordonnés.
 * @returns {Array<{ hafsStart: number, hafsCount: number, riwayahStart: number, riwayahCount: number }>} Opérations d'alignement.
 */
function alignSequences(hafsItems, riwayahItems) {
	const rows = hafsItems.length + 1;
	const columns = riwayahItems.length + 1;
	const costs = Array.from({ length: rows }, () => Array(columns).fill(Number.POSITIVE_INFINITY));
	const previous = Array.from({ length: rows }, () => Array(columns).fill(null));
	costs[0][0] = 0;
	const maxOffset = Math.max(8, Math.abs(hafsItems.length - riwayahItems.length) + 4);

	for (let hafsIndex = 0; hafsIndex <= hafsItems.length; hafsIndex++) {
		const center = Math.round((hafsIndex * riwayahItems.length) / Math.max(hafsItems.length, 1));
		const start = Math.max(0, center - maxOffset);
		const end = Math.min(riwayahItems.length, center + maxOffset);
		for (let riwayahIndex = start; riwayahIndex <= end; riwayahIndex++) {
			const currentCost = costs[hafsIndex][riwayahIndex];
			if (!Number.isFinite(currentCost)) continue;

			const transitions = [];
			if (hafsIndex < hafsItems.length) transitions.push([1, 0, 1]);
			if (riwayahIndex < riwayahItems.length) transitions.push([0, 1, 1]);
			for (
				let hafsCount = 1;
				hafsCount <= 3 && hafsIndex + hafsCount <= hafsItems.length;
				hafsCount++
			) {
				for (
					let riwayahCount = 1;
					riwayahCount <= 3 && riwayahIndex + riwayahCount <= riwayahItems.length;
					riwayahCount++
				) {
					transitions.push([
						hafsCount,
						riwayahCount,
						getGroupCost(
							hafsItems.slice(hafsIndex, hafsIndex + hafsCount),
							riwayahItems.slice(riwayahIndex, riwayahIndex + riwayahCount)
						)
					]);
				}
			}

			for (const [hafsCount, riwayahCount, transitionCost] of transitions) {
				const nextHafsIndex = hafsIndex + hafsCount;
				const nextRiwayahIndex = riwayahIndex + riwayahCount;
				const nextCost = currentCost + transitionCost;
				if (nextCost >= costs[nextHafsIndex][nextRiwayahIndex]) continue;
				costs[nextHafsIndex][nextRiwayahIndex] = nextCost;
				previous[nextHafsIndex][nextRiwayahIndex] = {
					hafsIndex,
					riwayahIndex,
					hafsCount,
					riwayahCount
				};
			}
		}
	}

	const operations = [];
	let hafsIndex = hafsItems.length;
	let riwayahIndex = riwayahItems.length;
	while (hafsIndex > 0 || riwayahIndex > 0) {
		const operation = previous[hafsIndex][riwayahIndex];
		if (!operation) throw new Error('Unable to align Hafs and riwāyah sequences.');
		operations.push({
			hafsStart: operation.hafsIndex,
			hafsCount: operation.hafsCount,
			riwayahStart: operation.riwayahIndex,
			riwayahCount: operation.riwayahCount
		});
		hafsIndex = operation.hafsIndex;
		riwayahIndex = operation.riwayahIndex;
	}
	return operations.reverse();
}

/**
 * Aligne deux chaînes proches avec l'algorithme de Myers et retourne leurs caractères communs.
 * @param {string} left Texte Hafs normalisé.
 * @param {string} right Texte de la riwāyah normalisé.
 * @returns {Array<[number, number]>} Paires d'indices de caractères alignés.
 */
function alignCharacters(left, right) {
	const trace = [];
	const furthest = new Map([[1, 0]]);
	const maximumDistance = left.length + right.length;

	for (let distance = 0; distance <= maximumDistance; distance++) {
		trace.push(new Map(furthest));
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			const down = furthest.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
			const rightward = (furthest.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) + 1;
			let leftIndex =
				diagonal === -distance || (diagonal !== distance && rightward < down) ? down : rightward;
			let rightIndex = leftIndex - diagonal;
			while (
				leftIndex < left.length &&
				rightIndex < right.length &&
				left[leftIndex] === right[rightIndex]
			) {
				leftIndex++;
				rightIndex++;
			}
			furthest.set(diagonal, leftIndex);
			if (leftIndex < left.length || rightIndex < right.length) continue;

			const matches = [];
			let backtrackLeft = left.length;
			let backtrackRight = right.length;
			for (let backtrackDistance = trace.length - 1; backtrackDistance >= 0; backtrackDistance--) {
				const previous = trace[backtrackDistance];
				const currentDiagonal = backtrackLeft - backtrackRight;
				const previousDown = previous.get(currentDiagonal + 1) ?? Number.NEGATIVE_INFINITY;
				const previousRight = (previous.get(currentDiagonal - 1) ?? Number.NEGATIVE_INFINITY) + 1;
				const previousDiagonal =
					currentDiagonal === -backtrackDistance ||
					(currentDiagonal !== backtrackDistance && previousRight < previousDown)
						? currentDiagonal + 1
						: currentDiagonal - 1;
				const previousLeft = Math.max(previous.get(previousDiagonal) ?? 0, 0);
				const previousRightIndex = previousLeft - previousDiagonal;
				while (backtrackLeft > previousLeft && backtrackRight > previousRightIndex) {
					matches.push([backtrackLeft - 1, backtrackRight - 1]);
					backtrackLeft--;
					backtrackRight--;
				}
				if (backtrackDistance === 0) break;
				if (backtrackLeft === previousLeft) backtrackRight--;
				else backtrackLeft--;
			}
			return matches.reverse();
		}
	}
	throw new Error('Unable to align Hafs and riwāyah characters.');
}

/**
 * Retire le numéro final tout en conservant le texte Unicode KFGQPC.
 * @param {string} text Texte brut d'une āyah.
 * @returns {string} Texte sans numéro final.
 */
function stripAyahNumber(text) {
	return text.replace(/[\u00A0\s]+[٠-٩]+\s*$/u, '').trim();
}

/**
 * Découpe une āyah en rattachant les symboles de juz/hizb au mot suivant.
 * @param {string} text Texte d'āyah sans numéro final.
 * @returns {string[]} Mots compatibles avec le rendu et l'alignement.
 */
function tokenizeRiwayahText(text) {
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
 * Construit le mapping bidirectionnel à partir des frontières réelles des datasets KFGQPC.
 * @param {Array<object>} hafsSource Dataset Hafs KFGQPC.
 * @param {Array<object>} riwayahSource Dataset de la riwāyah KFGQPC.
 * @param {{ name: string, slug: string, data: string }} config Configuration de la riwāyah.
 * @returns {object} Mapping Hafs/riwāyah complet.
 */
function buildAyahMapping(hafsSource, riwayahSource, config) {
	const hafsToRiwayah = {};
	const riwayahToHafs = {};

	for (let surah = 1; surah <= 114; surah++) {
		const hafsAyahs = hafsSource
			.filter((ayah) => Number(ayah.sora) === surah)
			.map((ayah) => ({
				number: Number(ayah.aya_no),
				text: stripAyahNumber(ayah.aya_text),
				normalized: normalizeArabic(ayah.aya_text)
			}));
		const riwayahAyahs = riwayahSource
			.filter((ayah) => Number(ayah.sura_no) === surah)
			.map((ayah) => ({
				number: Number(ayah.aya_no),
				text: stripAyahNumber(ayah.aya_text),
				normalized: normalizeArabic(ayah.aya_text)
			}));
		hafsToRiwayah[String(surah)] = {};
		riwayahToHafs[String(surah)] = {};
		if (surah === 1 && !riwayahAyahs[0].normalized.startsWith(hafsAyahs[0].normalized)) {
			// La basmala reste imprimée, mais n'est pas une āyah indépendante dans ces datasets.
			for (let verse = 1; verse <= 7; verse++) {
				const targets = verse === 1 ? [] : verse === 7 ? [6, 7] : [verse - 1];
				hafsToRiwayah['1'][String(verse)] = {
					targets,
					relation:
						targets.length === 0 ? 'no_independent_target' : targets.length > 1 ? 'split' : 'mapped'
				};
			}
			for (let verse = 1; verse <= 7; verse++) {
				riwayahToHafs['1'][String(verse)] = {
					targets: [verse === 7 ? 7 : verse + 1],
					relation: verse >= 6 ? 'part_of_split' : 'mapped'
				};
			}
			continue;
		}

		const hafsOwners = hafsAyahs.flatMap((ayah) => [...ayah.normalized].map(() => ayah.number));
		const riwayahOwners = riwayahAyahs.flatMap((ayah) =>
			[...ayah.normalized].map(() => ayah.number)
		);
		const hafsTargets = new Map(hafsAyahs.map((ayah) => [ayah.number, new Set()]));
		const riwayahTargets = new Map(riwayahAyahs.map((ayah) => [ayah.number, new Set()]));
		for (const [hafsIndex, riwayahIndex] of alignCharacters(
			hafsAyahs.map((ayah) => ayah.normalized).join(''),
			riwayahAyahs.map((ayah) => ayah.normalized).join('')
		)) {
			const hafsVerse = hafsOwners[hafsIndex];
			const riwayahVerse = riwayahOwners[riwayahIndex];
			hafsTargets.get(hafsVerse).add(riwayahVerse);
			riwayahTargets.get(riwayahVerse).add(hafsVerse);
		}

		for (const [verse, targetsSet] of hafsTargets) {
			const targets = [...targetsSet].sort((left, right) => left - right);
			const coversMultiple = targets.some((target) => (riwayahTargets.get(target)?.size ?? 0) > 1);
			hafsToRiwayah[String(surah)][String(verse)] = {
				targets,
				relation:
					targets.length === 0
						? 'no_independent_target'
						: targets.length > 1
							? 'split'
							: coversMultiple
								? 'merged'
								: 'mapped'
			};
		}
		for (const [verse, targetsSet] of riwayahTargets) {
			const targets = [...targetsSet].sort((left, right) => left - right);
			const partOfSplit = targets.some((target) => (hafsTargets.get(target)?.size ?? 0) > 1);
			riwayahToHafs[String(surah)][String(verse)] = {
				targets,
				relation: targets.length > 1 ? 'covers_multiple' : partOfSplit ? 'part_of_split' : 'mapped'
			};
		}
	}

	return {
		_meta: {
			format_version: 1,
			description: `Ayah-number mapping between KFGQPC Hafs and ${config.name} datasets.`,
			hafs_ayah_count: hafsSource.length,
			riwayah: config.name,
			riwayah_ayah_count: riwayahSource.length,
			method:
				'Verse-group alignment after Arabic normalization; Al-Fatihah basmala is aligned explicitly.'
		},
		hafs_to_riwayah: hafsToRiwayah,
		riwayah_to_hafs: riwayahToHafs
	};
}

/**
 * Construit les composantes connexes Hafs/riwāyah d'une sourate.
 * @param {Record<string, { targets: number[] }>} surahMapping Mapping direct d'une sourate.
 * @returns {Array<{ hafs: number[], riwayah: number[] }>} Composantes ordonnées.
 */
function getMappingComponents(surahMapping) {
	const remaining = new Set(Object.keys(surahMapping).map(Number));
	const components = [];
	while (remaining.size > 0) {
		const first = Math.min(...remaining);
		const hafs = new Set([first]);
		const riwayah = new Set(surahMapping[first].targets);
		let changed = true;
		while (changed) {
			changed = false;
			for (const candidate of remaining) {
				if (hafs.has(candidate)) continue;
				const targets = surahMapping[candidate].targets;
				if (!targets.some((target) => riwayah.has(target))) continue;
				hafs.add(candidate);
				for (const target of targets) riwayah.add(target);
				changed = true;
			}
		}
		for (const verse of hafs) remaining.delete(verse);
		components.push({
			hafs: [...hafs].sort((a, b) => a - b),
			riwayah: [...riwayah].sort((a, b) => a - b)
		});
	}
	return components;
}

/**
 * Sélectionne le mot Hafs propriétaire d'un mot de la riwāyah aligné.
 * @param {Array<{ text: string, verse: number, index: number }>} candidates Mots Hafs candidats.
 * @param {{ text: string }} riwayahWord Mot de la riwāyah.
 * @returns {{ text: string, verse: number, index: number }} Propriétaire le plus proche lexicalement.
 */
function selectOwner(candidates, riwayahWord) {
	return candidates.reduce((best, candidate) => {
		const bestCost = getGroupCost([best], [riwayahWord]);
		const candidateCost = getGroupCost([candidate], [riwayahWord]);
		return candidateCost < bestCost ? candidate : best;
	});
}

/**
 * Vérifie que les segments Hafs-indexés reconstruisent exactement chaque āyah KFGQPC source.
 * @param {Record<string, { words: Array<{ text: string, verseEnd?: number }> }>} verses Segments générés.
 * @param {object} mapping Mapping Hafs vers riwāyah.
 * @param {Array<object>} riwayahSource Dataset KFGQPC source.
 * @param {string} riwayahName Nom utilisé dans les erreurs.
 * @returns {void}
 */
function validateGeneratedVerses(verses, mapping, riwayahSource, riwayahName) {
	const reconstructed = {};
	for (let surah = 1; surah <= 114; surah++) {
		let pendingWords = [];
		const surahMapping = mapping.hafs_to_riwayah[String(surah)];
		for (const verse of Object.keys(surahMapping)
			.map(Number)
			.sort((left, right) => left - right)) {
			if (surahMapping[String(verse)].targets.length === 0) continue;
			for (const word of verses[`${surah}:${verse}`].words) {
				pendingWords.push(word.text);
				if (!word.verseEnd) continue;
				reconstructed[`${surah}:${word.verseEnd}`] = pendingWords.join(' ');
				pendingWords = [];
			}
		}
		if (pendingWords.length > 0) {
			throw new Error(`Unterminated ${riwayahName} text in surah ${surah}.`);
		}
	}

	for (const ayah of riwayahSource) {
		const key = `${ayah.sura_no}:${ayah.aya_no}`;
		const expected = tokenizeRiwayahText(stripAyahNumber(ayah.aya_text)).join(' ');
		if (reconstructed[key] !== expected) {
			throw new Error(`Generated ${riwayahName} text differs from KFGQPC at ${key}.`);
		}
	}
}

/**
 * Génère les données embarquées d'une riwāyah et ses polices KFGQPC.
 * @param {Array<object>} hafsSource Dataset Hafs KFGQPC.
 * @param {{ name: string, slug: string, data: string, font: string }} config Configuration source.
 * @returns {Promise<void>} Promesse résolue après l'écriture des fichiers.
 */
async function syncRiwayah(hafsSource, config) {
	const dataUrl = `${REPOSITORY_URL}/${config.data}`;
	const riwayahSource = JSON.parse((await download(dataUrl)).toString('utf8'));
	const mapping = buildAyahMapping(hafsSource, riwayahSource, config);
	const outputDirectory = path.resolve(`static/riwayat/${config.slug}`);
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(path.join(outputDirectory, 'ayah-map.json'), JSON.stringify(mapping));
	if (mappingsOnly) {
		console.log(`Generated ${config.name} ayah mapping.`);
		return;
	}
	const riwayahByKey = Object.fromEntries(
		riwayahSource.map((ayah) => [`${ayah.sura_no}:${ayah.aya_no}`, stripAyahNumber(ayah.aya_text)])
	);
	const verses = {};

	for (let surah = 1; surah <= 114; surah++) {
		const hafsSurah = JSON.parse(
			await readFile(path.resolve(`static/quran/${surah}.json`), 'utf8')
		);
		const surahMapping = mapping.hafs_to_riwayah[String(surah)];
		for (const verse of Object.keys(surahMapping)) verses[`${surah}:${verse}`] = { words: [] };

		for (const component of getMappingComponents(surahMapping)) {
			if (component.riwayah.length === 0) {
				if (surah !== 1 || component.hafs.length !== 1 || component.hafs[0] !== 1) {
					throw new Error(`Unsupported unnumbered ${config.name} component in ${surah}.`);
				}
				const sourceWords = tokenizeRiwayahText(riwayahByKey['27:30']);
				const basmalaStart = sourceWords.findIndex((word) => normalizeArabic(word) === 'بسم');
				const basmala = sourceWords.slice(basmalaStart).join(' ');
				if (basmalaStart < 0) {
					throw new Error(`Unable to derive the ${config.name} basmala from 27:30.`);
				}
				const hafsWords = hafsSurah['1'].w.map((word, index) => ({
					text: word.c,
					verse: 1,
					index
				}));
				const riwayahWords = tokenizeRiwayahText(basmala).map((text, index) => ({
					text,
					verse: 0,
					index
				}));
				for (const operation of alignSequences(hafsWords, riwayahWords)) {
					const sources = hafsWords.slice(
						operation.hafsStart,
						operation.hafsStart + operation.hafsCount
					);
					for (const word of riwayahWords.slice(
						operation.riwayahStart,
						operation.riwayahStart + operation.riwayahCount
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
			const riwayahWords = component.riwayah.flatMap((verse) => {
				const words = tokenizeRiwayahText(riwayahByKey[`${surah}:${verse}`]);
				return words.map((text, index) => ({
					text,
					verse,
					index,
					...(index === words.length - 1 ? { verseEnd: verse } : {})
				}));
			});

			let lastOwner = hafsWords[0];
			for (const operation of alignSequences(hafsWords, riwayahWords)) {
				const sources = hafsWords.slice(
					operation.hafsStart,
					operation.hafsStart + operation.hafsCount
				);
				const targets = riwayahWords.slice(
					operation.riwayahStart,
					operation.riwayahStart + operation.riwayahCount
				);
				for (const word of targets) {
					const nextSource = hafsWords[operation.hafsStart + operation.hafsCount];
					const owner = sources.length > 0 ? selectOwner(sources, word) : (lastOwner ?? nextSource);
					if (!owner)
						throw new Error(
							`Unable to own ${config.name} word ${surah}:${word.verse}:${word.index}.`
						);
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
	validateGeneratedVerses(verses, mapping, riwayahSource, config.name);

	await writeFile(
		path.join(outputDirectory, 'verses.json'),
		JSON.stringify({
			_meta: { source: dataUrl, riwayah: config.name, ayahCount: riwayahSource.length },
			verses
		})
	);
	await writeFile(
		path.join(outputDirectory, 'font.ttf'),
		await download(`${CDN_URL}/${config.font}.ttf`)
	);
	await writeFile(
		path.join(outputDirectory, 'font.woff2'),
		await download(`${CDN_URL}/${config.font}.woff2`)
	);

	console.log(`Generated ${Object.keys(verses).length} Hafs-indexed ${config.name} entries.`);
}

const hafsSource = JSON.parse((await download(HAFS_DATA_URL)).toString('utf8'));
for (const config of RIWAYAT.filter(
	(candidate) => !selectedSlug || candidate.slug === selectedSlug
)) {
	await syncRiwayah(hafsSource, config);
}
