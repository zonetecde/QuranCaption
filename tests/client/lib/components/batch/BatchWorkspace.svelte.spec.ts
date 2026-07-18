import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
	load: vi.fn(),
	normalizeInterruptedMedia: vi.fn(async () => false),
	loadUserBatchesDetails: vi.fn(async () => [])
}));

vi.mock('$lib/services/BatchService', () => ({ BatchService: serviceMocks }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: { load: vi.fn() } }));
vi.mock('$lib/services/DiscordService', () => ({
	discordService: { setEditingState: vi.fn() }
}));

import { Batch, type BatchProjectItem } from '$lib/classes';
import BatchWorkspace from '$lib/components/batch/BatchWorkspace.svelte';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Construit une ligne média pour le test du workspace.
 * @param {number} id Identifiant du projet.
 * @param {BatchProjectItem['media']['status']} status État média initial.
 * @param {BatchProjectItem['source']} source Source média.
 * @returns {BatchProjectItem} Ligne prête à afficher.
 */
function createProject(
	id: number,
	status: BatchProjectItem['media']['status'],
	source: BatchProjectItem['source']
): BatchProjectItem {
	return {
		order: id,
		projectId: id,
		projectName: `Project ${id}`,
		reciter: 'Reciter',
		source,
		media: {
			status,
			progress: status === 'failed' ? 64 : 0,
			error: status === 'failed' ? 'Import failed' : null,
			resolvedAssetPath: null,
			mode: null,
			assetId: null
		}
	};
}

describe('BatchWorkspace media import', () => {
	afterEach(() => {
		cleanup();
		globalState.currentBatchId = null;
		globalState.currentPage = 'home';
		serviceMocks.load.mockReset();
	});

	test('selects retryable rows and blocks video mode for local audio', async () => {
		const projects = [
			createProject(1, 'pending', { kind: 'file', value: 'C:\\media\\recitation.mp3' }),
			createProject(2, 'failed', { kind: 'url', value: 'https://example.com/video' }),
			createProject(3, 'completed', { kind: 'url', value: 'https://example.com/done' }),
			createProject(4, 'processing', { kind: 'url', value: 'https://example.com/active' })
		];
		serviceMocks.load.mockResolvedValue(new Batch('Batch', projects, 99));
		globalState.currentBatchId = 99;

		const component = render(BatchWorkspace);
		await vi.waitFor(() => {
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(4);
		});

		const rowCheckboxes = component.container.querySelectorAll<HTMLInputElement>(
			'tbody input[type="checkbox"]'
		);
		expect(rowCheckboxes[0].checked).toBe(true);
		expect(rowCheckboxes[1].checked).toBe(true);
		expect(rowCheckboxes[2].checked).toBe(false);
		expect(rowCheckboxes[3].disabled).toBe(true);
		expect(component.container.textContent).toContain('Import failed');
		expect(component.container.textContent).toContain('64%');

		const importButton =
			component.container.querySelector<HTMLButtonElement>('header .btn-primary')!;
		await importButton.click();
		let modal!: Element;
		await vi.waitFor(() => {
			modal = component.container.querySelector('[role="dialog"]')!;
			expect(modal).not.toBeNull();
		});
		const radios = modal.querySelectorAll<HTMLInputElement>('input[type="radio"]');
		expect(radios).toHaveLength(2);
		await radios[1].click();
		expect(modal.textContent).toContain('Project 1');
		const modalButtons = modal.querySelectorAll<HTMLButtonElement>('button');
		expect(modalButtons[modalButtons.length - 1].disabled).toBe(true);

		const openButtons = component.container.querySelectorAll<HTMLButtonElement>('tbody button');
		expect(openButtons[3].disabled).toBe(true);
	});
});
