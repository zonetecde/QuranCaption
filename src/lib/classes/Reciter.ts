import { globalState } from '$lib/runes/main.svelte';

export class Reciter {
	arabic: string;
	latin: string;
	number: number;

	constructor(data: { arabic: string; latin: string; number: number }) {
		this.arabic = data.arabic;
		this.latin = data.latin;
		this.number = data.number;
	}
}

function isReciterData(value: unknown): value is { arabic: string; latin: string; number: number } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'arabic' in value &&
		'latin' in value &&
		'number' in value
	);
}

export default class RecitersManager {
	static reciters: Reciter[] = [];

	constructor() {}

	static async loadReciters() {
		try {
			const response = await fetch('/reciters/reciters.json');
			const data: unknown = await response.json();
			if (!Array.isArray(data)) {
				this.reciters = [];
				return;
			}
			this.reciters = data.filter(isReciterData).map((item) => new Reciter(item));
		} catch (error) {
			console.error('Failed to load reciters:', error);
		}
	}

	static getRecitersWithCustomOnes() {
		const reciters: { label: string; isCustom: boolean }[] = this.reciters.map((r) => ({
			label: r.latin,
			isCustom: false
		}));
		// Ajoute aussi tout les récitateurs des autres projets qui sont "custom"
		if (globalState.userProjectsDetails) {
			globalState.userProjectsDetails.forEach((project) => {
				if (project.reciter && !reciters.find((r) => r.label === project.reciter)) {
					reciters.push({ label: project.reciter, isCustom: true });
				}
			});
		}

		console.log('nbre reciteur custom :', reciters.filter((r) => r.isCustom).length);

		return reciters;
	}

	static getReciterObject(latinName: string): Reciter {
		return (
			this.reciters.find((r) => r.latin === latinName || r.arabic === latinName) ||
			new Reciter({ arabic: '', latin: latinName, number: -1 })
		);
	}
}
