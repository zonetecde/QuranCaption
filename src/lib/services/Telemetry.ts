import { VersionService } from './VersionService.svelte';

// Variable pour stocker le timestamp de la dernière requête
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 60 * 1000; // 1 minute en millisecondes

/**
 * M'envoie un message avec un délai minimum d'1 minute entre les requêtes
 * @param msg Le message à envoyer
 */
export async function telemetry(msg: string) {
	const now = Date.now();
	const timeSinceLastRequest = now - lastRequestTime;

	// Vérifier si le délai minimum est respecté
	if (timeSinceLastRequest < MIN_INTERVAL_MS) {
		const remainingTime = MIN_INTERVAL_MS - timeSinceLastRequest;
		console.log(
			`Telemetry: Délai minimum non respecté. Prochaine requête possible dans ${Math.ceil(remainingTime / 1000)} secondes.`
		);
		return;
	}

	msg = '(' + VersionService.currentVersion + ') ' + msg;

	try {
		const url = 'https://rayanestaszewski.fr/telemetry-quran-caption';
		fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ msg: msg })
		});

		// Mettre à jour le timestamp seulement si la requête a été tentée
		lastRequestTime = now;
	} catch (err) {
		console.warn('telemetry failed', err);
	}
}
