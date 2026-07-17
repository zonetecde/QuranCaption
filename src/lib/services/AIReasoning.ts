export type AIReasoningMode = 'auto' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'maximum';
type ConcreteAIReasoningMode = Exclude<AIReasoningMode, 'auto'>;
export type AIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
export type TextAIProvider = 'openai' | 'gemini' | 'openrouter' | 'groq' | 'deepseek' | 'custom';

export type TextAIPreset = {
	id: Exclude<TextAIProvider, 'custom'>;
	label: string;
	endpoint: string;
	model: string;
};

export type ResolvedAIReasoning = {
	effort: AIReasoningEffort;
	thinkingEnabled: boolean | null;
};

export const AI_REASONING_MODES: AIReasoningMode[] = [
	'auto',
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'maximum'
];

export const TEXT_AI_PRESETS: TextAIPreset[] = [
	{
		id: 'openai',
		label: 'OpenAI',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		model: 'gpt-5.4-mini'
	},
	{
		id: 'gemini',
		label: 'Gemini',
		endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
		model: 'gemini-3.1-flash-lite'
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		endpoint: 'https://openrouter.ai/api/v1/chat/completions',
		model: 'z-ai/glm-4.7-flash'
	},
	{
		id: 'groq',
		label: 'Groq',
		endpoint: 'https://api.groq.com/openai/v1/chat/completions',
		model: 'openai/gpt-oss-120b'
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		endpoint: 'https://api.deepseek.com/chat/completions',
		model: 'deepseek-v4-flash'
	}
];

/**
 * Indique si une valeur peut être utilisée comme mode de raisonnement persistant.
 * @param {unknown} value Valeur à vérifier.
 * @returns {value is AIReasoningMode} `true` lorsque la valeur est supportée.
 */
export function isAIReasoningMode(value: unknown): value is AIReasoningMode {
	return typeof value === 'string' && AI_REASONING_MODES.includes(value as AIReasoningMode);
}

/**
 * Déduit le fournisseur depuis l'endpoint OpenAI-compatible configuré.
 * @param {string} endpoint Endpoint du fournisseur.
 * @returns {TextAIProvider} Fournisseur reconnu ou `custom`.
 */
export function detectTextAIProvider(endpoint: string): TextAIProvider {
	const normalized = endpoint.toLowerCase();
	if (normalized.includes('api.openai.com')) return 'openai';
	if (normalized.includes('generativelanguage.googleapis.com')) return 'gemini';
	if (normalized.includes('openrouter.ai')) return 'openrouter';
	if (normalized.includes('api.groq.com')) return 'groq';
	if (normalized.includes('api.deepseek.com')) return 'deepseek';
	return 'custom';
}

/**
 * Retourne uniquement les modes supportés par le modèle sélectionné.
 * @param {string} endpoint Endpoint du fournisseur.
 * @param {string} model Identifiant du modèle.
 * @returns {AIReasoningMode[]} Modes affichables dans l'interface.
 */
export function getSupportedAIReasoningModes(endpoint: string, model: string): AIReasoningMode[] {
	const provider = detectTextAIProvider(endpoint);
	const normalizedModel = model.toLowerCase();
	if (provider === 'deepseek' && normalizedModel.includes('deepseek-v4')) {
		return ['auto', 'off', 'high', 'maximum'];
	}
	if (provider === 'gemini' && normalizedModel.includes('gemini-3')) {
		return ['auto', 'minimal', 'low', 'medium', 'high'];
	}
	if (provider === 'groq' && normalizedModel.includes('gpt-oss')) {
		return ['auto', 'low', 'medium', 'high'];
	}
	if (provider === 'openrouter' && normalizedModel === 'z-ai/glm-4.7-flash') {
		return ['auto', 'off', 'high'];
	}
	if (provider === 'openai' && normalizedModel.startsWith('gpt-5.')) {
		return ['auto', 'off', 'low', 'medium', 'high', 'maximum'];
	}
	return AI_REASONING_MODES;
}

/**
 * Résout le mode Auto selon la tâche et le fournisseur.
 * @param {TextAIProvider} provider Fournisseur détecté.
 * @returns {AIReasoningMode} Mode concret recommandé.
 */
function resolveAutoMode(provider: TextAIProvider): ConcreteAIReasoningMode {
	if (provider === 'deepseek' || provider === 'openrouter') return 'high';
	return 'medium';
}

/**
 * Convertit un choix UI en paramètres réellement acceptés par le fournisseur.
 * @param {string} endpoint Endpoint du fournisseur.
 * @param {string} model Identifiant du modèle.
 * @param {AIReasoningMode} mode Mode choisi par l'utilisateur.
 * @returns {ResolvedAIReasoning} Effort et interrupteur thinking à envoyer.
 */
export function resolveAIReasoning(
	endpoint: string,
	model: string,
	mode: AIReasoningMode
): ResolvedAIReasoning {
	const provider = detectTextAIProvider(endpoint);
	const resolvedMode: ConcreteAIReasoningMode = mode === 'auto' ? resolveAutoMode(provider) : mode;

	if (provider === 'deepseek') {
		if (resolvedMode === 'off') return { effort: 'none', thinkingEnabled: false };
		return {
			effort: resolvedMode === 'maximum' ? 'max' : 'high',
			thinkingEnabled: true
		};
	}

	if (provider === 'openrouter') {
		if (resolvedMode === 'off') return { effort: 'none', thinkingEnabled: false };
		if (model.toLowerCase() === 'z-ai/glm-4.7-flash') {
			return { effort: 'none', thinkingEnabled: true };
		}
		return {
			effort:
				resolvedMode === 'maximum' ? 'high' : resolvedMode === 'minimal' ? 'low' : resolvedMode,
			thinkingEnabled: true
		};
	}

	if (provider === 'gemini') {
		return {
			effort:
				resolvedMode === 'off' || resolvedMode === 'minimal'
					? 'minimal'
					: resolvedMode === 'maximum'
						? 'high'
						: resolvedMode,
			thinkingEnabled: null
		};
	}

	if (provider === 'groq') {
		return {
			effort:
				resolvedMode === 'off' || resolvedMode === 'minimal'
					? 'low'
					: resolvedMode === 'maximum'
						? 'high'
						: resolvedMode,
			thinkingEnabled: null
		};
	}

	return {
		effort:
			resolvedMode === 'off'
				? 'none'
				: resolvedMode === 'minimal'
					? 'low'
					: resolvedMode === 'maximum'
						? 'xhigh'
						: resolvedMode,
		thinkingEnabled: null
	};
}
