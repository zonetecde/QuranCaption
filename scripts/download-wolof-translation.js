// https://alhafiz.jappandal.org/sura/N

import fs from 'fs/promises';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
const IT_DIR = path.join(__dirname, '..', 'static', 'translations', 'it');
const WOLOF_DIR = path.join(__dirname, '..', 'static', 'translations', 'wolof');

// Crée le dossier wolof si besoin
await fs.mkdir(WOLOF_DIR, { recursive: true });

for (let i = 1; i <= 114; i++) {
	const url = `https://alhafiz.jappandal.org/sura/${i}`;
	const html = await fetch(url).then((res) => res.text());
	const texts = extractAllTextsBetween(html, '<footer class="text-justify">', '</footer>');

	// Lire la structure italienne pour la métadonnée
	const itFile = path.join(IT_DIR, `${i}.json`);
	let structure;
	try {
		const itContent = await fs.readFile(itFile, 'utf8');
		structure = JSON.parse(itContent);
	} catch (e) {
		console.error(`Impossible de lire ${itFile}`, e);
		continue;
	}

	// Créer la nouvelle structure
	const meta = structure[0];
	const newArr = [meta];
	for (let j = 0; j < texts.length; j++) {
		newArr.push([j + 1, texts[j]]);
	}

	// Sauvegarder le fichier
	const outFile = path.join(WOLOF_DIR, `${i}.json`);
	await fs.writeFile(outFile, JSON.stringify(newArr, null, 2), 'utf8');
	console.log(`✅ Sourate ${i} sauvegardée (${texts.length} versets)`);
}

function extractAllTextsBetween(html, startTag, endTag) {
	const regex = new RegExp(`${startTag}(.*?)${endTag}`, 'gs');
	const matches = [];
	let match;
	while ((match = regex.exec(html)) !== null) {
		matches.push(match[1].trim());
	}
	return matches;
}
