import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

/**
 * Traduit les noms d'intervenant réservés sans modifier les valeurs enregistrées.
 * @param {string} speaker Nom de l'intervenant dans le projet.
 * @returns {string} Nom à afficher dans l'interface.
 */
export function getSpeakerDisplayName(speaker: string): string {
	if (speaker === 'Unknown speaker') return Reflect.get(get(LL).editor, 'unknownSpeaker')();
	return speaker;
}
