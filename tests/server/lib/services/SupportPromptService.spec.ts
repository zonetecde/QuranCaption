import { describe, expect, it } from 'vitest';

import {
	SUPPORT_PROMPT_COOLDOWN_MS,
	shouldShowSupportPrompt
} from '$lib/services/SupportPromptService';

describe('shouldShowSupportPrompt', () => {
	it('returns true when last close timestamp is the epoch', () => {
		const now = Date.now();
		expect(shouldShowSupportPrompt(new Date(0).toISOString(), now)).toBe(true);
	});

	it('returns false when prompt was closed recently', () => {
		const now = Date.now();
		const recent = new Date(now - SUPPORT_PROMPT_COOLDOWN_MS + 1).toISOString();
		expect(shouldShowSupportPrompt(recent, now)).toBe(false);
	});

	it('returns true exactly at the 72h boundary', () => {
		const now = Date.now();
		const atBoundary = new Date(now - SUPPORT_PROMPT_COOLDOWN_MS).toISOString();
		expect(shouldShowSupportPrompt(atBoundary, now)).toBe(true);
	});

	it('returns true when timestamp is invalid', () => {
		expect(shouldShowSupportPrompt('not-a-date', Date.now())).toBe(true);
	});

	it('accepts Date instances without forcing visibility', () => {
		const now = Date.now();
		const recent = new Date(now - SUPPORT_PROMPT_COOLDOWN_MS + 1);
		expect(shouldShowSupportPrompt(recent, now)).toBe(false);
	});
});
