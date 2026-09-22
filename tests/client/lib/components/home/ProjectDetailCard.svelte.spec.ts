import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test } from 'vitest';

import { ProjectDetail } from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import ProjectDetailCard from '$lib/components/home/ProjectDetailCard.svelte';
import { globalState } from '$lib/runes/main.svelte';

describe('ProjectDetailCard direction', () => {
	afterEach(() => {
		cleanup();
		globalState.settings = undefined;
	});

	test('keeps thumbnail geometry LTR while preserving RTL edit controls', () => {
		globalState.settings = new Settings();
		const projectDetail = new ProjectDetail('Tutorial Project', 'Yasser Al-Dosari');
		const component = render(ProjectDetailCard, { projectDetail });
		const thumbnail = component.container.querySelector('section');
		const reciter = thumbnail?.querySelector('[data-project-reciter]');

		expect(thumbnail?.getAttribute('dir')).toBe('ltr');
		expect(reciter?.getAttribute('dir')).toBe('auto');
		expect(component.container.querySelector('button[dir="auto"]')).toBeNull();
		expect(component.container.querySelector('button h4[dir="auto"]')).not.toBeNull();
	});
});
