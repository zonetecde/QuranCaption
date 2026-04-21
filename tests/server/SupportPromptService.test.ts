import { describe, expect, it } from 'vitest';
import {
	DONATION_PROMPT_COOLDOWN_MS,
	shouldShowDonationPrompt
} from '$lib/services/SupportPromptService';

describe('SupportPromptService donation cooldown', () => {
	it('shows prompt if never dismissed', () => {
		const now = Date.UTC(2026, 0, 1);
		expect(shouldShowDonationPrompt(undefined, now)).toBe(true);
	});

	it('does not show prompt before 14 days after dismissal', () => {
		const now = Date.UTC(2026, 0, 15);
		const justBeforeCooldown = new Date(now - DONATION_PROMPT_COOLDOWN_MS + 1).toISOString();
		expect(shouldShowDonationPrompt(justBeforeCooldown, now)).toBe(false);
	});

	it('shows prompt again after 14 days', () => {
		const now = Date.UTC(2026, 0, 15);
		const closedAt = new Date(now - DONATION_PROMPT_COOLDOWN_MS).toISOString();
		expect(shouldShowDonationPrompt(closedAt, now)).toBe(true);
	});
});
