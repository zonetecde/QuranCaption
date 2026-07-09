import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import StyleComponent from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Style } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';

describe('direct style controls', () => {
	afterEach(() => {
		cleanup();
		globalState.currentProject = null;
	});

	test('renders a boolean control as one flat row', () => {
		globalState.currentProject = { projectEditorState: new ProjectEditorState() } as never;
		const style = new Style({
			id: 'show-subtitles',
			icon: 'visibility',
			value: true,
			valueType: 'boolean'
		});

		const component = render(StyleComponent, {
			style,
			disabled: false,
			showControl: true,
			applyValueSimple: vi.fn()
		});
		const control = component.container.firstElementChild;

		expect(control).toHaveClass('style-control-direct');
		expect(control?.children).toHaveLength(1);
	});
});
