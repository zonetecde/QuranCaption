import { describe, expect, it } from 'vitest';
import { getWizardSteps } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/constants';

describe('getWizardSteps', () => {
	it('inserts the existing-subtitles choice immediately before review', () => {
		expect(getWizardSteps('multi_v2', 'cloud', true).map(({ key }) => key)).toEqual([
			'version',
			'models',
			'settings',
			'existing-subtitles',
			'review'
		]);
	});

	it('keeps the current steps when fewer than three subtitles exist', () => {
		expect(getWizardSteps('multi_v2', 'cloud', false).map(({ key }) => key)).toEqual([
			'version',
			'models',
			'settings',
			'review'
		]);
	});
});
