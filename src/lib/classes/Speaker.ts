import { globalState } from '$lib/runes/main.svelte';

export class Speaker {
	arabic: string;
	latin: string;
	number: number;

	/**
	 * Construit les noms et la référence calligraphique d'un intervenant.
	 * @param {{ arabic: string; latin: string; number: number }} data Entrée du catalogue.
	 */
	constructor(data: { arabic: string; latin: string; number: number }) {
		this.arabic = data.arabic;
		this.latin = data.latin;
		this.number = data.number;
	}
}

/**
 * Vérifie la structure d'une entrée du catalogue d'intervenants.
 * @param {unknown} value Entrée reçue.
 * @returns {boolean} Vrai si les champs attendus sont présents.
 */
function isSpeakerData(value: unknown): value is { arabic: string; latin: string; number: number } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'arabic' in value &&
		'latin' in value &&
		'number' in value
	);
}

export default class SpeakersManager {
	static speakers: Speaker[] = [];

	constructor() {}

	/**
	 * Charge les noms et calligraphies embarqués.
	 * @returns {Promise<void>} Fin du chargement du catalogue.
	 */
	static async loadSpeakers() {
		try {
			const response = await fetch('/speakers/speakers.json');
			const data: unknown = await response.json();
			if (!Array.isArray(data)) {
				this.speakers = [];
				return;
			}
			this.speakers = data.filter(isSpeakerData).map((item) => new Speaker(item));
		} catch (error) {
			console.error('Failed to load speakers:', error);
		}
	}

	/**
	 * Complète le catalogue avec les intervenants saisis dans les projets.
	 * @returns {{ label: string; isCustom: boolean }[]} Suggestions disponibles.
	 */
	static getSpeakersWithCustomOnes() {
		const speakers: { label: string; isCustom: boolean }[] = this.speakers.map((r) => ({
			label: r.latin,
			isCustom: false
		}));
		// Ajoute aussi tout les intervenants des autres projets qui sont "custom"
		if (globalState.userProjectsDetails) {
			globalState.userProjectsDetails.forEach((project) => {
				if (project.speaker && !speakers.find((r) => r.label === project.speaker)) {
					speakers.push({ label: project.speaker, isCustom: true });
				}
			});
		}

		console.log('nbre intervenant custom :', speakers.filter((r) => r.isCustom).length);

		return speakers;
	}

	/**
	 * Résout un nom connu ou crée une entrée libre sans calligraphie.
	 * @param {string} latinName Nom recherché.
	 * @returns {Speaker} Intervenant trouvé ou entrée libre.
	 */
	static getSpeakerObject(latinName: string): Speaker {
		return (
			this.speakers.find((r) => r.latin === latinName || r.arabic === latinName) ||
			new Speaker({ arabic: '', latin: latinName, number: -1 })
		);
	}
}
