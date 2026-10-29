import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import Settings from '$lib/classes/Settings.svelte';

import { Category, Style, StylesData, Timeline, VideoStyle, ProjectContent } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import CreateProjectModal from '$lib/components/home/modals/CreateProjectModal.svelte';

vi.mock('svelte-5-french-toast', () => ({
	default: {
		error: vi.fn()
	}
}));

describe('CreateProjectModal', () => {
	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		globalState.settings = new Settings();
		globalState.currentProject = null;
		globalState.userProjectsDetails = [];
		const videoStyle = new VideoStyle();
		videoStyle.styles = [
			new StylesData('global', [
				new Category({
					id: 'general',
					styles: [new Style({ id: 'video-dimension', value: { width: 1920, height: 1080 } })]
				})
			])
		];
		vi.spyOn(ProjectContent, 'getDefaultProjectContent').mockResolvedValue(
			new ProjectContent(new Timeline(), [], undefined, videoStyle)
		);
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
		const speakerInput = inputs[1] as HTMLInputElement;
		const typeSelect = component.getByRole('combobox');

		await nameInput.focus();
		nameInput.value = 'Ramadan Night 27';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));

		await speakerInput.focus();
		speakerInput.value = 'Yasser Al Dosari';
		speakerInput.dispatchEvent(new Event('input', { bubbles: true }));

		await typeSelect.selectOptions('Khutbah');
		await component.getByRole('button', { name: 'crop_portrait 9:16 Portrait' }).click();
		await component.getByRole('button', { name: 'Create Project' }).click();
		await tick();

		expect(globalState.currentProject?.detail.projectType).toBe('Khutbah');
		expect(
			globalState.getVideoStyle.getStylesOfTarget('global').findStyle('video-dimension')?.value
		).toEqual({ width: 1080, height: 1920 });
		expect(AnalyticsService.trackProjectCreated).toHaveBeenCalledWith(
			'Ramadan Night 27',
			'Yasser Al Dosari',
			'Khutbah'
		);
		expect(close).toHaveBeenCalledTimes(1);
	});
});
