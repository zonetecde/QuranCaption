import type { AiPlan } from './types';

/**
 * Active le mode debug pour la feature AI Video.
 * Quand true, l'appel API reel est remplace par MOCK_AI_PLAN.
 */
export const IS_DEBUG_MODE = true;

/** Plan mock retourne quand IS_DEBUG_MODE est actif. */
export const MOCK_AI_PLAN: AiPlan = {
	title: 'Al Baqarah - The last Verses',
	videoPrompt:
		'A dramatic stormy landscape under a heavily clouded sky. Dark, billowing clouds roil overhead in shades of gray and deep charcoal, occasionally illuminated by distant lightning. The horizon is vast and open, capturing the raw power of nature. A slow, sweeping camera movement pans across the turbulent atmosphere, with wind-swept terrain in the foreground. The mood is intense and contemplative, evoking both awe and spiritual reflection.',
	reciterId: 123,
	reciter: 'Mishary Alafasi',
	surah: 2,
	ayahStart: 284,
	ayahEnd: 286
};
