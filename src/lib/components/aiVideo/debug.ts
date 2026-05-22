import type { AiPlan } from './types';

/**
 * Active le mode debug pour la feature AI Video.
 * Quand true, l'appel API reel est remplace par MOCK_AI_PLAN.
 */
export const IS_DEBUG_MODE = true;

/** Plan mock retourne quand IS_DEBUG_MODE est actif. */
export const MOCK_AI_PLAN: AiPlan = {
	title: 'Al-Fatiha — The Opening',
	videoPrompt:
		'A serene and contemplative visual scene unfolds in a beautiful, tranquil landscape, where lush greenery meets gentle rolling hills under a soft sunset. The colors are warm and inviting, featuring shades of gold and orange mixing with soft pastels. A slow, sweeping camera movement glides through the scene, capturing a babbling brook that flows gracefully, symbolizing peace and the passage of time.',
	reciterId: 54,
	reciter: 'Abdulrahman Alsudaes',
	surah: 1,
	ayahStart: 3,
	ayahEnd: 7
};
