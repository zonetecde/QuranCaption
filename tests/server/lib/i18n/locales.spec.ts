import { describe, expect, test } from 'vitest';
import en from '$lib/i18n/en';
import fr from '$lib/i18n/fr';
import ar from '$lib/i18n/ar';
import de from '$lib/i18n/de';
import es from '$lib/i18n/es';
import { getLocaleDirection } from '$lib/i18n/direction';
import { i18nObject, isLocale, loadedLocales, locales } from '$lib/i18n/i18n-util';
import { loadAllLocales } from '$lib/i18n/i18n-util.sync';
import { loadLocaleAsync } from '$lib/i18n/i18n-util.async';

/**
 * Lists dictionary messages by their full translation key.
 * @param {object} dictionary Nested locale dictionary.
 * @param {string} prefix Parent translation key.
 * @returns {Record<string, string>} Flattened messages.
 */
function messages(dictionary: object, prefix = ''): Record<string, string> {
	return Object.fromEntries(
		Object.entries(dictionary).flatMap(([key, value]) => {
			const fullKey = `${prefix}${key}`;
			return typeof value === 'string'
				? [[fullKey, value]]
				: Object.entries(messages(value, `${fullKey}.`));
		})
	);
}

/**
 * Lists interpolation variables independently of their type and repetition.
 * @param {string} message Translated message.
 * @returns {string[]} Sorted unique variable names.
 */
function variables(message: string): string[] {
	return [
		...new Set([...message.matchAll(/\{(\w+)(?::[^}]+)?\}/g)].map((match) => match[1]))
	].sort();
}

const english = messages(en);

describe.each(Object.entries({ fr, ar, de, es }))(
	'%s interface translation',
	(locale, dictionary) => {
		test('covers the current Minbar dictionary with matching interpolation variables', () => {
			const translated = messages(dictionary);
			expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
			for (const [key, source] of Object.entries(english)) {
				expect(translated[key].trim(), key).not.toBe('');
				expect(variables(translated[key]), key).toEqual(variables(source));
				expect(translated[key], key).not.toMatch(/Quran\s*Caption|\.qc\b/i);
			}
		});

		test('loads synchronously and asynchronously and formats Minbar messages', async () => {
			loadAllLocales();
			expect(isLocale(locale)).toBe(true);
			if (!isLocale(locale)) throw new Error(`Unsupported locale: ${locale}`);
			expect(loadedLocales[locale]).toEqual(dictionary);
			await loadLocaleAsync(locale);
			expect(loadedLocales[locale]).toEqual(dictionary);
			expect(i18nObject(locale).editor.speaker()).toBe(dictionary.editor.speaker);
			expect(
				i18nObject(locale).settings.workingOnProject({ name: 'Project', speaker: 'Speaker' })
			).toContain('Speaker');
			expect(i18nObject(locale).export.exportTranslationReviewWarning({ count: 3 })).toContain('3');
		});
	}
);

test('supports English and the four requested languages, with RTL only for Arabic', () => {
	expect([...locales].sort()).toEqual(['ar', 'de', 'en', 'es', 'fr']);
	for (const locale of locales) {
		expect(getLocaleDirection(locale)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
	}
	expect(isLocale('unknown')).toBe(false);
});
