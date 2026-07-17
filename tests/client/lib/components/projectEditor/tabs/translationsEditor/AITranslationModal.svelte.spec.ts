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
	estimateAIProjectTranslationBatchCount: vi.fn(() => 1),
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

	test('uses overwrite defaults, streams AI output and hides the run button when complete', async () => {
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

		expect(getCheckbox(component.container, 'Overwrite AI translations').checked).toBe(true);
		expect(getCheckbox(component.container, 'Overwrite reviewed translations').checked).toBe(true);
		expect(getCheckbox(component.container, 'Overwrite manual Quran translations').checked).toBe(
			true
		);

		const reasoningSelect = component.container.querySelector<HTMLSelectElement>(
			'#ai-translation-reasoning-mode'
		)!;
		expect(reasoningSelect.value).toBe('medium');
		reasoningSelect.value = 'high';
		reasoningSelect.dispatchEvent(new Event('change', { bubbles: true }));
		expect(globalState.settings!.aiTranslationSettings.projectTranslationReasoningMode).toBe(
			'high'
		);
		expect(Settings.save).toHaveBeenCalled();

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
				expect.objectContaining({ islamicTermMode: 'translated' })
			);
			const streamedValues = Array.from(
				component.container.querySelectorAll<HTMLTextAreaElement>('textarea[readonly]')
			).map((textarea) => textarea.value);
			expect(streamedValues).toContain('Reasoning live');
			expect(streamedValues).toContain('{"i":[]}');
			expect(
				Array.from(component.container.querySelectorAll('button')).some((button) =>
					button.textContent?.includes('Translate video')
				)
			).toBe(false);
		});
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
