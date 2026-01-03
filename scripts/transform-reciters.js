import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtenir le répertoire actuel pour les modules ES
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lire le fichier /reciters/reciters.json
const reciterFilePath = path.join(__dirname, '..', 'static', '/reciters/reciters.json');
const reciters = JSON.parse(fs.readFileSync(reciterFilePath, 'utf8'));

// Transformer le tableau de strings en tableau d'objets
const transformedReciters = reciters.map((reciterName) => ({
	arabic: '', // vide comme demandé
	latin: reciterName,
	number: -1 // -1 comme demandé
}));

// Sauvegarder le résultat dans un nouveau fichier
const outputPath = path.join(__dirname, '..', 'static', 'reciter-transformed.json');
fs.writeFileSync(outputPath, JSON.stringify(transformedReciters, null, 2), 'utf8');

console.log(`✅ Transformation terminée ! ${reciters.length} récitateurs transformés.`);
console.log(`📁 Fichier sauvegardé : ${outputPath}`);
console.log('\n📋 Exemple des premiers éléments :');
console.log(JSON.stringify(transformedReciters.slice(0, 3), null, 2));
