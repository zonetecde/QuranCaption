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

	it('includes setup but excludes settings for quran_word_timing when setup is not ready', () => {
		expect(
			getWizardSteps('quran_word_timing', 'local', false, false).map(({ key }) => key)
		).toEqual(['version', 'setup', 'review']);
	});

	it('hides setup and settings for quran_word_timing when setup is already ready', () => {
		expect(getWizardSteps('quran_word_timing', 'local', false, true).map(({ key }) => key)).toEqual(
			['version', 'review']
		);
	});

	it('inserts existing-subtitles before review for ready quran_word_timing when subtitles exist', () => {
		expect(getWizardSteps('quran_word_timing', 'local', true, true).map(({ key }) => key)).toEqual([
			'version',
			'existing-subtitles',
			'review'
		]);
	});
});
