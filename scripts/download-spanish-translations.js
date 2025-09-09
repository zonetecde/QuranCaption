import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Créer le dossier de destination s'il n'existe pas
const outputDir = path.join(__dirname, '..', 'static', 'translations', 'es');
if (!fs.existsSync(outputDir)) {
	fs.mkdirSync(outputDir, { recursive: true });
}

// Fonction pour télécharger une URL
function downloadJson(url) {
	return new Promise((resolve, reject) => {
		https
			.get(url, (res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch (error) {
						reject(error);
					}
				});
			})
			.on('error', (error) => {
				reject(error);
			});
	});
}

// Fonction pour convertir les codepoints Unicode en array
function getCodepoints(arabicText) {
	const codepoints = [];
	for (let i = 0; i < arabicText.length; i++) {
		const codepoint = arabicText.codePointAt(i);
		if (codepoint) {
			codepoints.push(codepoint);
			// Gérer les caractères surrogate pairs
			if (codepoint > 0xffff) {
				i++;
			}
		}
	}
	return codepoints;
}

// Mapping des noms de sourates en arabe vers leur translittération
const surahNames = {
	1: { transliterated: 'Al-Fatihah', city: 'makkah' },
	2: { transliterated: 'Al-Baqarah', city: 'madinah' },
	3: { transliterated: "Ali 'Imran", city: 'madinah' },
	4: { transliterated: 'An-Nisa', city: 'madinah' },
	5: { transliterated: "Al-Ma'idah", city: 'madinah' },
	6: { transliterated: "Al-An'am", city: 'makkah' },
	7: { transliterated: "Al-A'raf", city: 'makkah' },
	8: { transliterated: 'Al-Anfal', city: 'madinah' },
	9: { transliterated: 'At-Tawbah', city: 'madinah' },
	10: { transliterated: 'Yunus', city: 'makkah' }
	// Ajoutez plus de mappings si nécessaire, ou utilisez la translittération de l'API
};

// Fonction pour créer le slug à partir du nom translittéré
function createSlug(name) {
	return name.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
}

// Fonction pour traiter une sourate
async function processSurah(surahNumber) {
	try {
		console.log(`Téléchargement de la sourate ${surahNumber}...`);

		const url = `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/dist/chapters/es/${surahNumber}.json`;
		const data = await downloadJson(url);

		// Déterminer la ville (makkah/madinah) basée sur le type
		const city = data.type === 'meccan' ? 'makkah' : 'madinah';

		// Créer l'objet d'en-tête de la sourate
		const header = {
			id: data.id,
			city: city,
			name: {
				translated: data.translation,
				transliterated: surahNames[surahNumber]?.transliterated || data.transliteration,
				codepoints: getCodepoints(data.name)
			},
			ayahs: data.total_verses,
			slug: createSlug(surahNames[surahNumber]?.transliterated || data.transliteration),
			translator: 'Traducción española'
		};

		// Créer le tableau de résultat avec l'en-tête en premier
		const result = [header];

		// Ajouter chaque verset sous forme de tableau [numéro, traduction]
		data.verses.forEach((verse) => {
			result.push([verse.id, verse.translation]);
		});

		// Sauvegarder le fichier
		const outputPath = path.join(outputDir, `${surahNumber}.json`);
		fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

		console.log(`✓ Sourate ${surahNumber} sauvegardée dans ${outputPath}`);
	} catch (error) {
		console.error(`✗ Erreur lors du traitement de la sourate ${surahNumber}:`, error.message);
	}
}

// Fonction principale
async function downloadAllSurahs() {
	console.log('Début du téléchargement des traductions espagnoles...\n');

	// Traiter les sourates une par une pour éviter de surcharger le serveur
	for (let i = 1; i <= 114; i++) {
		await processSurah(i);

		// Petite pause entre les requêtes
		if (i < 114) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}

	console.log('\n✓ Téléchargement terminé ! Tous les fichiers sont dans static/translations/es/');
}

// Exécuter le script
downloadAllSurahs().catch(console.error);
