import { globalState } from '$lib/runes/main.svelte';
import { IS_DEBUG_MODE, MOCK_AI_PLAN } from './debug';
import { resolveAiReciterOption } from './reciterLoader';
import type { AiPlan } from './types';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import {
	buildTextAIRequestBody,
	extractTextFromResponse,
	parseAiJsonResponse
} from '$lib/services/TextAIRequest';

/**
 * Attend un delai donne pour simuler une latence reseau.
 * @param {number} ms Duree d'attente en millisecondes.
 * @returns {Promise<void>} Promise resolue apres le delai.
 */
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Genere un plan de projet video via l'IA (ou manuellement si letAiChoose est desactive).
 * Cote la page, construit le prompt system, appelle l'API et parse la reponse JSON.
 * @param {string} reciterList Liste des recitateurs formatee pour le prompt (obtenue via buildReciterListForAi).
 * @returns {Promise<AiPlan>} Plan complet (titre, plage de versets, recitateur, prompt video).
 */
export async function generateAiPlan(reciterList: string): Promise<AiPlan> {
	const aiv = globalState.aiVideo;

	// Mode manuel : pas d'appel IA, on retourne les selections de l'utilisateur
	if (!aiv.ai.letAiChoose) {
		return {
			title: aiv.video.prompt.trim().slice(0, 50) || 'AI Video Project',
			videoPrompt: aiv.video.prompt,
			reciter: aiv.audio.reciterName,
			reciterId: aiv.audio.reciter?.reciterId ?? 0,
			surah: aiv.selectedVerseRange.surah,
			ayahStart: aiv.selectedVerseRange.startVerse,
			ayahEnd: aiv.selectedVerseRange.endVerse
		};
	}

	// Mode debug : retourne le plan mock sans appel API
	if (IS_DEBUG_MODE) {
		console.log('[AiVideo] DEBUG MODE — returning mock AI plan');
		await wait(4000);
		return { ...MOCK_AI_PLAN };
	}

	// Verification des prerequis
	if (aiv.reciterOptions.length === 0) {
		toast.error(get(LL).aiVideo.recitersStillLoading());
		throw new Error('Reciters not loaded yet');
	}

	const aiSettings = globalState.settings?.aiTranslationSettings;
	if (!aiSettings?.openAiApiKey || !aiSettings?.textAiApiEndpoint) {
		toast.error(get(LL).aiVideo.configureAiKey());
		throw new Error('AI settings not configured');
	}

	const shouldAskForVideoPrompt = aiv.video.sourceMode === 'ai';
	const forcedReciterOption =
		aiv.audio.reciter && !aiv.audio.useLocal
			? resolveAiReciterOption(aiv.audio.reciter.reciterId)
			: null;
	const forcedReciterInstruction = forcedReciterOption
		? `\nThe user already selected this reciter. You MUST use reciterId = ${forcedReciterOption.reciterId}, reciter = "${forcedReciterOption.reciterName}".`
		: '';

	const systemPrompt = `You are a Quran video planning assistant. Given a theme or topic, you must:
1. Select the most relevant Quran verses for this theme
2. Choose a reciter from the available list below
${shouldAskForVideoPrompt ? '3. Write a detailed visual prompt that would be sent to an AI video generation model' : ''}

AVAILABLE RECITERS (you MUST pick from this list using exact IDs):
${reciterList}

Respond ONLY with valid JSON in this exact format:
{
  "title": "A short project title (max 50 characters) summarizing the theme and verses",
  "videoPrompt": "${shouldAskForVideoPrompt ? 'A cinematic, detailed visual description for AI video generation. Describe the mood, colors, camera movement, scenery. Do not include humans or any living beings. Be very descriptive and visual.' : ''}",
  "reciterId": <reciter ID from the list above>,
  "reciter": "Name of the selected reciter",
  "surah": <surah number 1-114>,
  "ayahStart": <starting verse number>,
  "ayahEnd": <ending verse number>
}

Rules:
- Choose verses that are MOST relevant to the given theme
- Keep the verse range reasonable (3-15 verses)
- ${shouldAskForVideoPrompt ? 'The videoPrompt should describe a beautiful, contemplative visual scene matching the theme, without humans or any living beings' : 'Leave videoPrompt as an empty string'}
- Pick a reciter whose style matches the mood (e.g. emotional themes → emotional reciter)
- You MUST use reciterId from the available reciters list${forcedReciterInstruction}`;

	const response = await fetch(aiSettings.textAiApiEndpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${aiSettings.openAiApiKey}`
		},
		body: JSON.stringify(
			buildTextAIRequestBody(
				aiSettings.textAiApiEndpoint,
				aiSettings.advancedTrimModel || 'gpt-4o-mini',
				systemPrompt,
				`Theme: "${aiv.video.prompt}"`
			)
		)
	});

	if (!response.ok) {
		const errorText = await response.text();
		toast.error(get(LL).aiVideo.aiApiError({ status: String(response.status) }));
		throw new Error(`AI API returned ${response.status}: ${errorText}`);
	}

	const data = await response.json();
	console.log('[AiVideo] AI plan raw response:', JSON.stringify(data, null, 2));

	const text = extractTextFromResponse(data);
	console.log('[AiVideo] AI plan extracted text:', text);

	if (!text) {
		toast.error(get(LL).aiVideo.aiEmptyResponse());
		throw new Error('No text response from AI');
	}

	const plan = parseAiJsonResponse<Record<string, string | number>>(text);
	console.log('[AiVideo] AI plan parsed:', plan);

	return {
		title: String(plan.title || aiv.video.prompt.trim().slice(0, 50)),
		videoPrompt: String(plan.videoPrompt || aiv.video.prompt),
		reciter: String(plan.reciter || 'Unknown'),
		reciterId: Number(plan.reciterId || 0),
		surah: Math.max(1, Math.min(114, Number(plan.surah || 1))),
		ayahStart: Math.max(1, Number(plan.ayahStart || 1)),
		ayahEnd: Math.max(1, Number(plan.ayahEnd || 7))
	};
}
