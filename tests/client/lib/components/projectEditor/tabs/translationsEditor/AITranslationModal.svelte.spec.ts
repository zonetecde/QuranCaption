import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Edition } from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import AskIAModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AskIAModal.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, (event: { payload: Record<string, string> }) => void>();
	return {
		listeners,
		getEligible: vi.fn(() => [{}]),
		buildBatches: vi.fn(async () => [
			{
				batchId: 'batch-1',
				candidates: [{}],
				beforeSubtitleIds: [],
				afterSubtitleIds: [],
				request: { b: [], i: [], a: [] },
				wordCount: 1
			}
		]),
		runBatch: vi.fn(async ({ batch }: { batch: { batchId: string } }) => {
			listeners.get('ai-project-translation-reasoning')?.({
				payload: { batchId: batch.batchId, accumulatedText: 'Reasoning live' }
			});
			listeners.get('ai-project-translation-chunk')?.({
				payload: { batchId: batch.batchId, accumulatedText: '{"i":[]}' }
			});
			return { batchId: batch.batchId, rawText: '{"i":[]}', parsed: { i: [] } };
		}),
		validateBatch: vi.fn(() => ({ validItems: [], errors: [] }))
	};
});

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(
		async (eventName: string, callback: (event: { payload: Record<string, string> }) => void) => {
			mocks.listeners.set(eventName, callback);
			return () => mocks.listeners.delete(eventName);
		}
	)
}));

vi.mock('$lib/services/AIProjectTranslationService', () => ({
	applyAIProjectTranslationResults: vi.fn(() => ({ appliedSubtitles: 0 })),
	buildAIProjectTranslationBatches: mocks.buildBatches,
	getEligibleAIProjectTranslationSubtitles: mocks.getEligible,
	resolveAIProjectTranslationSuccessContext: vi.fn(() => ''),
	runAIProjectTranslationBatchStreaming: mocks.runBatch,
	validateAIProjectTranslationBatch: mocks.validateBatch
}));

describe('AI translation modal', () => {
	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		globalState.settings = new Settings();
		globalState.settings.aiTranslationSettings.openAiApiKey = 'test-key';
		globalState.settings.aiTranslationSettings.textAiApiEndpoint =
			'https://api.openai.com/v1/responses';
		globalState.settings.aiTranslationSettings.advancedTrimModel = 'gpt-test';
		globalState.settings.aiTranslationSettings.projectTranslationReasoningMode = 'medium';
		vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
		mocks.buildBatches.mockClear();
		mocks.runBatch.mockClear();
		mocks.validateBatch.mockClear();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		mocks.listeners.clear();
		globalState.settings = undefined;
	});

	/**
	 * Retourne la checkbox associée à un libellé visible.
	 * @param {HTMLElement} container Conteneur du modal.
	 * @param {string} label Libellé recherché.
	 * @returns {HTMLInputElement} Checkbox correspondante.
	 */
	function getCheckbox(container: HTMLElement, label: string): HTMLInputElement {
		const element = Array.from(container.querySelectorAll('label')).find((entry) =>
			entry.textContent?.includes(label)
		);
		return element!.querySelector('input') as HTMLInputElement;
	}

	test('keeps terminology and preferences visible while protecting reviewed translations', async () => {
		const edition = new Edition(
			'language-french',
			'language-french',
			'French',
			'French',
			'ltr',
			'project-language',
			'',
			'',
			''
		);
		const component = render(AskIAModal, { edition, close: vi.fn() });

		expect(component.container.querySelector('input[type="range"]')).toBeNull();
		expect(component.container.querySelector('#ai-translation-reasoning-mode')).toBeNull();
		const salawat = getCheckbox(component.container, 'Write prayers on the Prophet as ﷺ');
		expect(salawat.checked).toBe(true);
		salawat.click();
		expect(getCheckbox(component.container, 'Overwrite manual Quran translations').checked).toBe(
			false
		);
		const preferences = component.container.querySelector<HTMLTextAreaElement>(
			'#ai-translation-preferences'
		)!;
		preferences.value = 'Use simple French';
		preferences.dispatchEvent(new Event('input', { bubbles: true }));

		const terminologySelect = component.container.querySelector<HTMLSelectElement>(
			'#ai-translation-islamic-terms'
		)!;
		expect(terminologySelect.value).toBe('both');
		terminologySelect.value = 'translated';
		terminologySelect.dispatchEvent(new Event('change', { bubbles: true }));
		expect(globalState.settings!.aiTranslationSettings.projectTranslationIslamicTerms).toBe(
			'translated'
		);

		const translateButton = Array.from(component.container.querySelectorAll('button')).find(
			(button) => button.textContent?.includes('Translate video')
		)!;
		translateButton.click();

		await vi.waitFor(() => {
			expect(mocks.runBatch).toHaveBeenCalledWith(
				expect.objectContaining({
					islamicTermMode: 'translated',
					additionalPreferences: 'Use simple French',
					useSalawatSymbol: false,
					reasoningEffort: 'medium'
				})
			);
			expect(mocks.buildBatches).toHaveBeenCalledWith(edition, {
				retryErrors: true,
				overwriteAiTranslated: false,
				overwriteReviewed: false,
				overwriteManualQuran: false
			});
			expect(component.container.textContent).not.toContain('{"i":[]}');
			expect(
				Array.from(component.container.querySelectorAll('button')).some((button) =>
					button.textContent?.includes('Translate video')
				)
			).toBe(false);
		});
	});

	test('stops launching queued batches after the current requests finish', async () => {
		const batches = Array.from({ length: 4 }, (_, index) => ({
			batchId: `stop-${index}`,
			candidates: [{}],
			beforeSubtitleIds: [],
			afterSubtitleIds: [],
			request: { b: [], i: [], a: [] },
			wordCount: 1
		}));
		mocks.buildBatches.mockResolvedValueOnce(batches);
		const releases: Array<() => void> = [];
		mocks.runBatch.mockImplementation(
			({ batch }: { batch: { batchId: string } }) =>
				new Promise((resolve) => {
					releases.push(() =>
						resolve({ batchId: batch.batchId, rawText: '{"i":[]}', parsed: { i: [] } })
					);
				})
		);
		const edition = new Edition(
			'test',
			'test',
			'French',
			'French',
			'ltr',
			'project-language',
			'',
			'',
			''
		);
		const component = render(AskIAModal, { edition, close: vi.fn() });
		Array.from(component.container.querySelectorAll('button'))
			.find((button) => button.textContent?.includes('Translate video'))!
			.click();
		await vi.waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(3));
		expect(mocks.runBatch).toHaveBeenCalledWith(
			expect.objectContaining({ useSalawatSymbol: true })
		);
		Array.from(component.container.querySelectorAll('button'))
			.find((button) => button.textContent?.includes('Stop after current requests'))!
			.click();
		await vi.waitFor(() => expect(component.container.textContent).toContain('Stopping'));
		for (const release of releases) release();
		await vi.waitFor(() =>
			expect(component.container.textContent).toContain('Translation stopped')
		);
		expect(mocks.runBatch).toHaveBeenCalledTimes(3);
	});

	test('runs at most three translation batches concurrently', async () => {
		const batches = Array.from({ length: 4 }, (_, index) => ({
			batchId: `batch-${index + 1}`,
			candidates: [{}],
			beforeSubtitleIds: [],
			afterSubtitleIds: [],
			request: { b: [], i: [], a: [] },
			wordCount: 1
		}));
		const releaseBatch: Array<() => void> = [];
		mocks.buildBatches.mockResolvedValueOnce(batches);
		mocks.runBatch.mockImplementation(
			({ batch }: { batch: { batchId: string } }) =>
				new Promise((resolve) => {
					releaseBatch.push(() =>
						resolve({ batchId: batch.batchId, rawText: '{"i":[]}', parsed: { i: [] } })
					);
				})
		);

		const edition = new Edition(
			'language-french',
			'language-french',
			'French',
			'French',
			'ltr',
			'project-language',
			'',
			'',
			''
		);
		const component = render(AskIAModal, { edition, close: vi.fn() });
		const translateButton = Array.from(component.container.querySelectorAll('button')).find(
			(button) => button.textContent?.includes('Translate video')
		)!;
		translateButton.click();

		await vi.waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(3));
		expect(releaseBatch).toHaveLength(3);
		for (let index = 1; index <= 4; index += 1) {
			expect(component.container.textContent).toContain(`Batch ${index} of 4`);
		}
		releaseBatch[0]();
		await vi.waitFor(() => expect(mocks.runBatch).toHaveBeenCalledTimes(4));
		for (const release of releaseBatch.slice(1)) release();
		await vi.waitFor(() => {
			expect(
				Array.from(component.container.querySelectorAll('button')).some((button) =>
					button.textContent?.includes('Translate video')
				)
			).toBe(false);
		});
	});
});
