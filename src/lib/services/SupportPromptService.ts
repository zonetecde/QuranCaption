export const SUPPORT_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // every week

function parseLastClosed(lastClosedSupportPromptModal: string | Date | undefined): Date | null {
	if (!lastClosedSupportPromptModal) return null;
	const parsed =
		lastClosedSupportPromptModal instanceof Date
			? lastClosedSupportPromptModal
			: new Date(lastClosedSupportPromptModal);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function shouldShowSupportPrompt(
	lastClosedSupportPromptModal: string | Date | undefined,
	now: number = Date.now()
): boolean {
	const parsed = parseLastClosed(lastClosedSupportPromptModal);
	if (!parsed) return true;

	return now - parsed.getTime() >= SUPPORT_PROMPT_COOLDOWN_MS;
}

export function getSupportPromptDelayMs(
	lastClosedSupportPromptModal: string | Date | undefined,
	now: number = Date.now()
): number {
	const parsed = parseLastClosed(lastClosedSupportPromptModal);
	if (!parsed) return 0;

	return Math.max(0, parsed.getTime() + SUPPORT_PROMPT_COOLDOWN_MS - now);
}
