export const DONATION_PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

function parseLastClosed(lastClosedDonationPromptModal: string | Date | undefined): Date | null {
	if (!lastClosedDonationPromptModal) return null;
	const parsed =
		lastClosedDonationPromptModal instanceof Date
			? lastClosedDonationPromptModal
			: new Date(lastClosedDonationPromptModal);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function shouldShowDonationPrompt(
	lastClosedDonationPromptModal: string | Date | undefined,
	now: number = Date.now()
): boolean {
	const parsed = parseLastClosed(lastClosedDonationPromptModal);
	if (!parsed) return true;

	return now - parsed.getTime() >= DONATION_PROMPT_COOLDOWN_MS;
}

export function getDonationPromptDelayMs(
	lastClosedDonationPromptModal: string | Date | undefined,
	now: number = Date.now()
): number {
	const parsed = parseLastClosed(lastClosedDonationPromptModal);
	if (!parsed) return 0;

	return Math.max(0, parsed.getTime() + DONATION_PROMPT_COOLDOWN_MS - now);
}
