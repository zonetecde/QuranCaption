import { describe, expect, it } from 'vitest';

import {
	DONATION_PROMPT_COOLDOWN_MS,
	shouldShowDonationPrompt
} from '$lib/services/SupportPromptService';

describe('shouldShowDonationPrompt', () => {
	it('returns true when last close timestamp is the epoch', () => {
		const now = Date.now();
		expect(shouldShowDonationPrompt(new Date(0).toISOString(), now)).toBe(true);
	});

	it('returns false when prompt was closed recently', () => {
		const now = Date.now();
		const recent = new Date(now - DONATION_PROMPT_COOLDOWN_MS + 1).toISOString();
		expect(shouldShowDonationPrompt(recent, now)).toBe(false);
	});

	it('returns true exactly at the cooldown boundary', () => {
		const now = Date.now();
		const atBoundary = new Date(now - DONATION_PROMPT_COOLDOWN_MS).toISOString();
		expect(shouldShowDonationPrompt(atBoundary, now)).toBe(true);
	});

	it('returns true when timestamp is invalid', () => {
		expect(shouldShowDonationPrompt('not-a-date', Date.now())).toBe(true);
	});

	it('accepts Date instances without forcing visibility', () => {
		const now = Date.now();
		const recent = new Date(now - DONATION_PROMPT_COOLDOWN_MS + 1);
		expect(shouldShowDonationPrompt(recent, now)).toBe(false);
	});
});
