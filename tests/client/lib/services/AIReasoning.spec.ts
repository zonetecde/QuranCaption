import { describe, expect, test } from 'vitest';

import { getSupportedAIReasoningModes, resolveAIReasoning } from '$lib/services/AIReasoning';

describe('AI reasoning settings', () => {
	test('resolves the automatic provider default for every workflow', () => {
		expect(
			resolveAIReasoning('https://api.deepseek.com/chat/completions', 'deepseek-v4-flash', 'auto')
		).toEqual({ effort: 'high', thinkingEnabled: true });
	});

	test('exposes only the levels accepted by known preset models', () => {
		expect(
			getSupportedAIReasoningModes('https://api.deepseek.com/chat/completions', 'deepseek-v4-flash')
		).toEqual(['auto', 'off', 'high', 'maximum']);
		expect(
			getSupportedAIReasoningModes(
				'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
				'gemini-3.1-flash-lite'
			)
		).toEqual(['auto', 'minimal', 'low', 'medium', 'high']);
		expect(
			getSupportedAIReasoningModes('https://api.openai.com/v1/chat/completions', 'gpt-5.4-mini')
		).toEqual(['auto', 'off', 'low', 'medium', 'high', 'maximum']);
		expect(
			getSupportedAIReasoningModes(
				'https://api.groq.com/openai/v1/chat/completions',
				'openai/gpt-oss-120b'
			)
		).toEqual(['auto', 'low', 'medium', 'high']);
		expect(
			getSupportedAIReasoningModes(
				'https://openrouter.ai/api/v1/chat/completions',
				'z-ai/glm-4.7-flash'
			)
		).toEqual(['auto', 'off', 'high']);
	});

	test('uses the OpenRouter boolean without an unsupported effort for GLM', () => {
		expect(
			resolveAIReasoning(
				'https://openrouter.ai/api/v1/chat/completions',
				'z-ai/glm-4.7-flash',
				'high'
			)
		).toEqual({ effort: 'none', thinkingEnabled: true });
	});
});
