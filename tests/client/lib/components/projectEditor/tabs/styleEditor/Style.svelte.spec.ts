import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import StyleComponent from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
import NumberControl from '$lib/components/projectEditor/tabs/styleEditor/controls/NumberControl.svelte';
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

	test('ignores range changes while the user scrolls vertically', () => {
		const style = new Style({
			id: 'font-size',
			value: 50,
			valueType: 'number',
			valueMin: 0,
			valueMax: 100
		});
		const onChange = vi.fn();
		const component = render(NumberControl, { style, value: 50, onChange });
		const range = component.container.querySelector('input[type="range"]') as HTMLInputElement;

		range.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				pointerId: 1,
				pointerType: 'touch',
				clientX: 100,
				clientY: 100
			})
		);
		range.value = '75';
		range.dispatchEvent(new InputEvent('input', { bubbles: true }));
		range.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				pointerId: 1,
				pointerType: 'touch',
				clientX: 102,
				clientY: 125
			})
		);
		range.dispatchEvent(
			new PointerEvent('pointercancel', {
				bubbles: true,
				pointerId: 1,
				pointerType: 'touch',
				clientX: 102,
				clientY: 125
			})
		);

		expect(onChange).not.toHaveBeenCalled();
		expect(range.value).toBe('50');
	});
});
