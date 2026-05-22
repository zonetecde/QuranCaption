import type { MockModel } from './types';

/** TODO: Remplacer par de vrais fournisseurs de generation video. */
export const MOCK_MODELS: MockModel[] = [
	{
		provider: 'Mock Provider',
		model: 'cinematic-nature',
		label: 'Mock Provider / Cinematic Nature'
	},
	{
		provider: 'Mock Provider',
		model: 'abstract-light',
		label: 'Mock Provider / Abstract Light'
	},
	{
		provider: 'Mock Provider',
		model: 'rainy-sky',
		label: 'Mock Provider / Rainy Sky'
	}
];

/** Mapping modele → URLs YouTube de fond pour chaque orientation. */
export const BACKGROUND_VIDEO_URLS = {
	'Mock Provider / Cinematic Nature': {
		landscape: 'https://www.youtube.com/watch?v=JUkNddtZ564',
		portrait: 'https://www.youtube.com/shorts/uDOLjJ3DDQs?feature=share'
	},
	'Mock Provider / Abstract Light': {
		landscape: 'https://www.youtube.com/watch?v=-qq9onL_3WQ',
		portrait: 'https://www.youtube.com/shorts/7U8yeMKPCG0'
	},
	'Mock Provider / Rainy Sky': {
		landscape: 'https://www.youtube.com/watch?v=8npvhQPUXSU',
		portrait: 'https://www.youtube.com/shorts/YL1jtKaZSmc'
	}
} as const;
