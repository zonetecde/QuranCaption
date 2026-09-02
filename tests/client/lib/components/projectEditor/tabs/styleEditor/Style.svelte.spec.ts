import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import toast from 'svelte-5-french-toast';

import StyleComponent from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Style } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('svelte-5-french-toast', () => ({ default: vi.fn() }));
vi.mock('$lib/services/undoRedo/ProjectHistoryManager', () => ({
	ProjectHistoryManager: {
		track: (_label: string, action: () => unknown) => action()
	}
}));

describe('direct style controls', () => {
	afterEach(() => {
		cleanup();
		vi.mocked(toast).mockClear();
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

	test('shows the interpolation notice only for the first project keyframe', async () => {
		const projectEditorState = new ProjectEditorState();
		globalState.currentProject = { projectEditorState } as never;
		const style = new Style({
			id: 'font-size',
			value: 50,
			valueType: 'number'
		});
		const component = render(StyleComponent, {
			style,
			disabled: false,
			showControl: true,
			applyValueSimple: vi.fn()
		});
		const toggle = component.container.querySelector<HTMLButtonElement>('.keyframe-toggle')!;

		await toggle.click();
		await toggle.click();
		await toggle.click();

		expect(toast).toHaveBeenCalledOnce();
		expect(toast).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ position: 'bottom-left' })
		);
		expect(projectEditorState.keyframeInterpolationNoticeShown).toBe(true);
	});

	test.each([
		['video-dimension', 'dimension'],
		['media-fill', 'boolean'],
		['media-scale', 'number'],
		['media-position-x', 'number'],
		['media-position-y', 'number'],
		['fade-duration', 'number'],
		['video-and-audio-fade', 'fade'],
		['video-clip-transition', 'select'],
		['video-clip-transition-duration', 'number'],
		['overlay-blur', 'number'],
		['riwayah', 'select'],
		['mushaf-style', 'select'],
		['reactive-font-size', 'number'],
		['reactive-y-position', 'number'],
		['always-show', 'boolean'],
		['surah-name-always-show', 'boolean'],
		['reciter-name-always-show', 'boolean'],
		['time-appearance', 'time'],
		['time-ranges', 'time-ranges'],
		['filepath', 'file'],
		['ayah-container-image', 'ayah-image']
	] as const)('does not expose keyframes for %s', (id, valueType) => {
		globalState.currentProject = { projectEditorState: new ProjectEditorState() } as never;
		const component = render(StyleComponent, {
			style: new Style({ id, value: '', valueType }),
			disabled: false,
			showControl: true,
			applyValueSimple: vi.fn()
		});

		expect(component.container.querySelector('[data-keyframe-controls]')).toBeNull();
	});

	test('keeps frame-rendered visual styles animatable', () => {
		globalState.currentProject = { projectEditorState: new ProjectEditorState() } as never;
		const component = render(StyleComponent, {
			style: new Style({ id: 'font-size', value: 50, valueType: 'number' }),
			disabled: false,
			showControl: true,
			applyValueSimple: vi.fn()
		});

		expect(component.container.querySelector('[data-keyframe-controls]')).not.toBeNull();
	});
});
