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
});
