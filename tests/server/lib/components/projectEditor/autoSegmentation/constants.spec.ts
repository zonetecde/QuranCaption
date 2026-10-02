import { describe, expect, it } from 'vitest';
import { getWizardSteps } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/constants';

describe('getWizardSteps', () => {
	it('keeps cloud alignment to three compact steps when subtitles already exist', () => {
		expect(getWizardSteps('multi_v2', 'cloud', true).map(({ key }) => key)).toEqual([
			'version',
			'models',
			'settings'
		]);
	});

	it('keeps cloud alignment to three compact steps for a new transcript', () => {
		expect(getWizardSteps('multi_v2', 'cloud', false).map(({ key }) => key)).toEqual([
			'version',
			'models',
			'settings'
		]);
	});

	it.each(['quran_word_timing', 'quran_word_timing_old'] as const)(
		'includes setup but excludes settings for %s when setup is not ready',
		(version) => {
			expect(getWizardSteps(version, 'local', false, false).map(({ key }) => key)).toEqual([
				'version',
				'setup',
				'review'
			]);
		}
	);

	it.each(['quran_word_timing', 'quran_word_timing_old'] as const)(
		'hides setup and settings for %s when setup is already ready',
		(version) => {
			expect(getWizardSteps(version, 'local', false, true).map(({ key }) => key)).toEqual([
				'version',
				'review'
			]);
		}
	);

	it.each(['quran_word_timing', 'quran_word_timing_old'] as const)(
		'inserts existing-subtitles before review for ready %s when subtitles exist',
		(version) => {
			expect(getWizardSteps(version, 'local', true, true).map(({ key }) => key)).toEqual([
				'version',
				'existing-subtitles',
				'review'
			]);
		}
	);
});
