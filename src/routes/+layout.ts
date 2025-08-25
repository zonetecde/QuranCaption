import { ProjectTranslation } from '$lib/classes';
import { Quran } from '$lib/classes/Quran';
import RecitersManager from '$lib/classes/Reciter';
import Settings from '$lib/classes/Settings.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import ExportService from '$lib/services/ExportService';
import QPCFontProvider from '$lib/services/FontProvider';
import { telemetry } from '$lib/services/Telemetry';
import VersionService from '$lib/services/VersionService';

export const prerender = true;
export const ssr = false;

// Load le Qur'an au démarrage de l'application
Quran.load();

// Load les réciteurs au démarrage de l'application
RecitersManager.loadReciters();

// Load la police d'écriture du Mushaf
QPCFontProvider.loadQPC2Data();

// Charge les exports
ExportService.loadExports();

// Charge les paramètres utilisateur
await Settings.load();

await VersionService.init();

// Charge les traductions si pas déjà fait
ProjectTranslation.loadAvailableTranslations();

// main.ts ou entrypoint
window.addEventListener('error', (event) => {
	event.preventDefault();
	showErrorDialog(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
	console.error(event);
	// event.preventDefault();
	// showErrorDialog(event.reason as Error);
});

function showErrorDialog(error: Error) {
	console.error(error);

	ModalManager.errorModal(
		'An unexpected error occurred',
		'Sorry — an error occurred while processing your request. It has been reported automatically. Please consider posting details about what you were doing on the Quran Caption Discord server to help me investigate! :)',
		JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
	);

	if (import.meta.env.PROD) {
		telemetry(
			'Une erreur est survenue sur Quran Caption.' +
				JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
		);
	}
}
