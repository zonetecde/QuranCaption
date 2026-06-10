import type { Status } from '$lib/classes/Status';
import type { TranslationFunctions } from './i18n-types';

/**
 * Retourne le libellé i18n correspondant au statut.
 * @param {Status} status - Le statut à traduire.
 * @param {TranslationFunctions} LL - Les fonctions de traduction.
 * @returns {string} Le libellé traduit, ou le statut brut si non trouvé.
 */
export function getStatusLabel(status: Status, LL: TranslationFunctions): string {
	const keyMap: Record<string, keyof TranslationFunctions['status']> = {
		'Not Set': 'notSet',
		'To Caption': 'toCaption',
		'To Translate': 'toTranslate',
		'To Review': 'toReview',
		'To Export': 'toExport',
		Exported: 'exported'
	};
	const key = keyMap[status.status];
	return key ? LL.status[key]() : status.status;
}

/**
 * Retourne le libellé i18n correspondant au type de projet.
 * @param {string} type - Le type de projet (Taraweeh, Prayer, etc.).
 * @param {TranslationFunctions} LL - Les fonctions de traduction.
 * @returns {string} Le libellé traduit, ou le type brut si non trouvé.
 */
export function getProjectTypeLabel(type: string, LL: TranslationFunctions): string {
	const keyMap: Record<string, keyof TranslationFunctions['status']> = {
		Taraweeh: 'taraweeh',
		Prayer: 'prayer',
		Studio: 'studio',
		'Old recordings': 'oldRecordings',
		'Rare recitation': 'rareRecitation',
		Others: 'others'
	};
	const key = keyMap[type];
	return key ? LL.status[key]() : type;
}
