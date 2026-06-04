import { ProjectTranslation } from '$lib/classes';
import { Quran } from '$lib/classes/Quran';
import RecitersManager from '$lib/classes/Reciter';
import Settings from '$lib/classes/Settings.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import ExportService from '$lib/services/ExportService';
import QPCFontProvider from '$lib/services/FontProvider';
import { loadAllLocales } from '$lib/i18n/i18n-util.sync';
import { i18nObject } from '$lib/i18n/i18n-util';

import { AnalyticsService } from '$lib/services/AnalyticsService';

export const prerender = true;
export const ssr = false;

// Initialize PostHog on the client
export const load = async () => {
	AnalyticsService.init();
};

// Load all i18n locales at startup
loadAllLocales();

// Load le Qur'an au démarrage de l'application
Quran.load();

// Load les réciteurs au démarrage de l'application
RecitersManager.loadReciters();

// Load la police d'écriture du Mushaf
QPCFontProvider.loadQPC2Data();

// Charge les exports
ExportService.loadExports();

// Charge les paramètres utilisateur
Settings.load();

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

	const L = i18nObject('en'); // fallback to English for error cases

	ModalManager.errorModal(
		L.common.unexpectedError(),
		L.common.sorryErrorMessage(),
		JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
	);

	if (import.meta.env.PROD) {
		AnalyticsService.trackError(error);
	}
}
