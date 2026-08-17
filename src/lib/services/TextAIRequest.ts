/**
 * Construit le corps de requête compatible avec les endpoints Responses API et Chat Completions.
 * @param {string} endpoint Endpoint texte configuré.
 * @param {string} model Modèle texte à utiliser.
 * @param {string} systemPrompt Instructions système envoyées au modèle.
 * @param {string} userPrompt Données et demande utilisateur envoyées au modèle.
 * @returns {Record<string, unknown>} Corps JSON prêt à être envoyé.
 */
export function buildTextAIRequestBody(
	endpoint: string,
	model: string,
	systemPrompt: string,
	userPrompt: string
): Record<string, unknown> {
	if (isChatCompletionsEndpoint(endpoint)) {
		return {
			model,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			]
		};
	}

	return {
		model,
		input: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		]
	};
}

/**
 * Extrait le texte d'une réponse Responses API ou Chat Completions.
 * @param {unknown} data Corps JSON renvoyé par le fournisseur IA.
 * @returns {string} Texte extrait, ou chaîne vide si aucun texte n'est disponible.
 */
export function extractTextFromResponse(data: unknown): string {
	const response = data as Record<string, unknown>;

	if (Array.isArray(response.choices)) {
		for (const choice of response.choices) {
			const content = choice?.message?.content;
			if (typeof content === 'string' && content.trim()) return content;
		}
	}

	let text = '';
	if (Array.isArray(response.output)) {
		for (const item of response.output) {
			if (item.type !== 'message' || !Array.isArray(item.content)) continue;
			for (const block of item.content) {
				if (block.type === 'output_text' && typeof block.text === 'string') {
					text = block.text;
				}
			}
		}
	}

	return text;
}

/**
 * Parse une réponse JSON éventuellement entourée d'un bloc Markdown.
 * @template T
 * @param {string} text Texte JSON brut renvoyé par le modèle.
 * @returns {T} Valeur JSON désérialisée.
 */
export function parseAiJsonResponse<T = unknown>(text: string): T {
	const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
	return JSON.parse(jsonMatch[1]!.trim()) as T;
}

/**
 * Indique si l'endpoint utilise le format Chat Completions compatible OpenAI.
 * @param {string} endpoint Endpoint texte configuré.
 * @returns {boolean} `true` lorsque le chemin se termine par `/chat/completions`.
 */
function isChatCompletionsEndpoint(endpoint: string): boolean {
	try {
		return new URL(endpoint).pathname.endsWith('/chat/completions');
	} catch {
		return false;
	}
}
