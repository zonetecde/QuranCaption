import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lire le fichier /speakers/speakers.json
const speakerPath = path.join(__dirname, '..', 'static', '/speakers/speakers.json');
const speakers = JSON.parse(fs.readFileSync(speakerPath, 'utf8'));

console.log(`Nombre total d’intervenants avant tri: ${speakers.length}`);

// Trier par ordre alphabétique selon le nom latin
speakers.sort((a, b) => {
	return a.latin.localeCompare(b.latin, 'en', {
		ignorePunctuation: true,
		sensitivity: 'base'
	});
});

console.log('Intervenants triés par ordre alphabétique (nom latin)');

// Afficher les premiers intervenants pour vérification
console.log('\nPremiers 10 intervenants:');
speakers.slice(0, 10).forEach((speaker, index) => {
	console.log(`${index + 1}. ${speaker.latin} (${speaker.arabic}) - Numéro: ${speaker.number}`);
});

console.log('\nDerniers 10 intervenants:');
speakers.slice(-10).forEach((speaker, index) => {
	console.log(
		`${speakers.length - 9 + index}. ${speaker.latin} (${speaker.arabic}) - Numéro: ${speaker.number}`
	);
});

// Écrire le fichier trié
fs.writeFileSync(speakerPath, JSON.stringify(speakers, null, '\t'), 'utf8');
console.log(
	`\nFichier /speakers/speakers.json trié avec succès! Total: ${speakers.length} intervenants`
);

// Afficher les intervenants avec un numéro assigné
const numberedSpeakers = speakers
	.filter((r) => r.number !== -1)
	.sort((a, b) => a.number - b.number);
console.log(`\nIntervenants avec numéros assignés: ${numberedSpeakers.length}`);
numberedSpeakers.forEach((speaker) => {
	console.log(`${speaker.number}. ${speaker.latin} (${speaker.arabic})`);
});
