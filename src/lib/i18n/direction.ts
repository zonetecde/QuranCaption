import type { Locales } from './i18n-types';

/**
 * Returns the writing direction used by an application locale.
 * @param {Locales} locale Active application locale.
 * @returns {'ltr' | 'rtl'} Locale writing direction.
 */
export function getLocaleDirection(locale: Locales): 'ltr' | 'rtl' {
	return locale === 'ar' ? 'rtl' : 'ltr';
}
