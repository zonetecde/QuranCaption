import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import { ProjectContent } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import CreateProjectModal from '$lib/components/home/modals/CreateProjectModal.svelte';

vi.mock('svelte-5-french-toast', () => ({
	default: {
		error: vi.fn()
	}
}));

vi.mock('$lib/services/DiscordService', () => ({
	discordService: {
		setEditingState: vi.fn()
	}
}));

describe('CreateProjectModal', () => {
	beforeEach(() => {
		globalState.currentProject = null;
		globalState.userProjectsDetails = [];
		vi.spyOn(ProjectContent, 'getDefaultProjectContent').mockResolvedValue({} as never);
		vi.spyOn(ProjectService, 'save').mockResolvedValue();
		vi.spyOn(AnalyticsService, 'trackProjectCreated').mockImplementation(() => undefined);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.userProjectsDetails = [];
	});

	test('creates a project with the selected type', async () => {
		const close = vi.fn();
		const component = render(CreateProjectModal, { close });
		const inputs = component.container.querySelectorAll('input');
		const nameInput = inputs[0] as HTMLInputElement;
		const reciterInput = inputs[1] as HTMLInputElement;
		const typeSelect = component.getByRole('combobox');

		await nameInput.focus();
		nameInput.value = 'Ramadan Night 27';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));

		await reciterInput.focus();
		reciterInput.value = 'Yasser Al Dosari';
		reciterInput.dispatchEvent(new Event('input', { bubbles: true }));

		await typeSelect.selectOptions('Prayer');
		await component.getByRole('button', { name: 'Create Project' }).click();
		await tick();

		expect(globalState.currentProject?.detail.projectType).toBe('Prayer');
		expect(AnalyticsService.trackProjectCreated).toHaveBeenCalledWith(
			'Ramadan Night 27',
			'Yasser Al Dosari',
			'Prayer'
		);
		expect(close).toHaveBeenCalledTimes(1);
	});
});
