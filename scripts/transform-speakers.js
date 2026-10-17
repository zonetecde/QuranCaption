import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtenir le répertoire actuel pour les modules ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lire le fichier /speakers/speakers.json
const speakerFilePath = path.join(__dirname, '..', 'static', '/speakers/speakers.json');
const speakers = JSON.parse(fs.readFileSync(speakerFilePath, 'utf8'));

// Transformer le tableau de strings en tableau d'objets
const transformedSpeakers = speakers.map((speakerName) => ({
	arabic: '', // vide comme demandé
	latin: speakerName,
	number: -1 // -1 comme demandé
}));

// Sauvegarder le résultat dans un nouveau fichier
const outputPath = path.join(__dirname, '..', 'static', 'speaker-transformed.json');
fs.writeFileSync(outputPath, JSON.stringify(transformedSpeakers, null, 2), 'utf8');

console.log(`✅ Transformation terminée ! ${speakers.length} intervenants transformés.`);
console.log(`📁 Fichier sauvegardé : ${outputPath}`);
console.log('\n📋 Exemple des premiers éléments :');
console.log(JSON.stringify(transformedSpeakers.slice(0, 3), null, 2));
