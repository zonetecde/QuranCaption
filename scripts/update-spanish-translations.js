import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Pour obtenir __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const API_BASE_URL = 'https://quranenc.com/api/v1/translation/sura/spanish_garcia/';
const TRANSLATIONS_DIR = path.join(__dirname, '..', 'static', 'translations', 'es');
const DELAY_BETWEEN_REQUESTS = 1000; // 1 seconde entre chaque requête pour éviter de surcharger l'API

// Fonction pour faire une pause
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fonction pour récupérer les données de l'API
async function fetchSurahTranslation(surahNumber) {
	try {
		console.log(`Récupération de la sourate ${surahNumber}...`);

		const response = await fetch(`${API_BASE_URL}${surahNumber}`);

		if (!response.ok) {
			throw new Error(`Erreur HTTP: ${response.status} pour la sourate ${surahNumber}`);
		}

		const data = await response.json();

		if (!data.result || !Array.isArray(data.result)) {
			throw new Error(`Format de réponse invalide pour la sourate ${surahNumber}`);
		}

		return data.result;
	} catch (error) {
		console.error(`Erreur lors de la récupération de la sourate ${surahNumber}:`, error.message);
		throw error;
	}
}

// Fonction pour lire le fichier JSON existant
async function readExistingFile(surahNumber) {
	try {
		const filePath = path.join(TRANSLATIONS_DIR, `${surahNumber}.json`);
		const fileContent = await fs.readFile(filePath, 'utf8');
		return JSON.parse(fileContent);
	} catch (error) {
		console.error(`Erreur lors de la lecture du fichier ${surahNumber}.json:`, error.message);
		throw error;
	}
}

// Fonction pour mettre à jour le fichier avec les nouvelles traductions
async function updateSurahFile(surahNumber, apiData) {
	try {
		// Lire le fichier existant pour conserver les métadonnées
		const existingData = await readExistingFile(surahNumber);

		// Le premier élément contient les métadonnées, on le conserve
		const metadata = existingData[0];

		// Créer le nouveau contenu avec les métadonnées existantes
		const newContent = [metadata];

		// Ajouter les nouveaux versets depuis l'API
		for (const verse of apiData) {
			const verseNumber = parseInt(verse.aya);
			let translation = verse.translation;

			// remove the number between brackets, e.g., "[1] Di: "Me refugio..."
			// remove all [1], [2], ...
			translation = translation
				.replace(/\[\d+\]/g, '') // remove bracketed numbers everywhere
				.replace(/\s{2,}/g, ' ') // collapse multiple spaces
				.replace(/\s+,/g, ',') // remove space before comma if any
				.trim();

			// Nettoyer la traduction en retirant le numéro au début s'il existe
			// Par exemple "1. Di: "Me refugio..." devient "Di: "Me refugio..."
			translation = translation.replace(/^\d+\.\s*/, '');

			newContent.push([verseNumber, translation]);
		}

		// Écrire le fichier mis à jour
		const filePath = path.join(TRANSLATIONS_DIR, `${surahNumber}.json`);
		await fs.writeFile(filePath, JSON.stringify(newContent, null, 2), 'utf8');

		console.log(`✅ Sourate ${surahNumber} mise à jour (${apiData.length} versets)`);
	} catch (error) {
		console.error(`❌ Erreur lors de la mise à jour de la sourate ${surahNumber}:`, error.message);
		throw error;
	}
}

// Fonction principale
async function updateAllTranslations() {
	console.log('🚀 Début de la mise à jour des traductions espagnoles...');
	console.log(`📁 Répertoire: ${TRANSLATIONS_DIR}`);

	let successCount = 0;
	let errorCount = 0;
	const errors = [];

	for (let surahNumber = 1; surahNumber <= 114; surahNumber++) {
		try {
			// Récupérer les données de l'API
			const apiData = await fetchSurahTranslation(surahNumber);

			// Mettre à jour le fichier
			await updateSurahFile(surahNumber, apiData);

			successCount++;

			// Pause entre les requêtes pour ne pas surcharger l'API
			if (surahNumber < 114) {
				await sleep(DELAY_BETWEEN_REQUESTS);
			}
		} catch (error) {
			errorCount++;
			errors.push({
				surah: surahNumber,
				error: error.message
			});

			console.error(`❌ Erreur pour la sourate ${surahNumber}: ${error.message}`);

			// Continuer avec la sourate suivante même en cas d'erreur
			continue;
		}
	}

	// Rapport final
	console.log('\n📊 Rapport final:');
	console.log(`✅ Succès: ${successCount}/114 sourates`);
	console.log(`❌ Erreurs: ${errorCount}/114 sourates`);

	if (errors.length > 0) {
		console.log('\n❌ Détails des erreurs:');
		errors.forEach(({ surah, error }) => {
			console.log(`  - Sourate ${surah}: ${error}`);
		});
	}

	if (successCount === 114) {
		console.log('\n🎉 Toutes les traductions ont été mises à jour avec succès !');
	} else {
		console.log(
			`\n⚠️  ${errorCount} erreur(s) rencontrée(s). Veuillez vérifier les fichiers concernés.`
		);
	}
}

// Fonction pour vérifier que le répertoire existe
async function checkDirectory() {
	try {
		await fs.access(TRANSLATIONS_DIR);
		console.log(`✅ Répertoire trouvé: ${TRANSLATIONS_DIR}`);
	} catch (error) {
		console.error(`❌ Répertoire non trouvé: ${TRANSLATIONS_DIR}`);
		console.error('Veuillez vérifier le chemin et réessayer.');
		process.exit(1);
	}
}

// Exécution du script
async function main() {
	try {
		await checkDirectory();
		await updateAllTranslations();
	} catch (error) {
		console.error('❌ Erreur fatale:', error.message);
		process.exit(1);
	}
}

main();
