import type { MockModel } from './types';

/** TODO: Remplacer par de vrais fournisseurs de generation video. */
export const MOCK_MODELS: MockModel[] = [
	{
		provider: 'Mock Provider',
		model: 'cinematic-nature',
		label: 'Pika Labs / High Quality'
	},
	{
		provider: 'Mock Provider',
		model: 'abstract-light',
		label: 'Pika Labs / Fast'
	},
	{
		provider: 'Mock Provider',
		model: 'rainy-sky',
		label: 'Pika Labs / Best Quality/Price Ratio'
	}
];

/** Mapping modele → URLs YouTube de fond pour chaque orientation. */
export const BACKGROUND_VIDEO_URLS = {
	'Pika Labs / High Quality': {
		landscape: 'https://www.youtube.com/watch?v=JUkNddtZ564',
		portrait: 'https://www.youtube.com/shorts/uDOLjJ3DDQs?feature=share'
	},
	'Pika Labs / Fast': {
		landscape: 'https://www.youtube.com/watch?v=-qq9onL_3WQ',
		portrait: 'https://www.youtube.com/shorts/7U8yeMKPCG0'
	},
	'Pika Labs / Best Quality/Price Ratio': {
		landscape: 'https://www.youtube.com/watch?v=8npvhQPUXSU',
		portrait: 'https://www.youtube.com/shorts/YL1jtKaZSmc'
	}
} as const;
