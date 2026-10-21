import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import toast from 'svelte-5-french-toast';

import StyleComponent from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
import NumberControl from '$lib/components/projectEditor/tabs/styleEditor/controls/NumberControl.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Style } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectContent } from '$lib/classes/ProjectContent.svelte';
import { moveOverlayLayer } from '$lib/services/OverlayLayerService';
import OverlayLayerControl from '$lib/components/projectEditor/tabs/styleEditor/controls/OverlayLayerControl.svelte';
import { createRawSnippet, tick } from 'svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import CompositeText from '$lib/components/projectEditor/tabs/styleEditor/CompositeText.svelte';

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
		vi.restoreAllMocks();
		globalState.currentProject = null;
	});

	test('renders the shared rotation slider and records its changes in history', async () => {
		const compositeDefinitions = await (await fetch('/styles/compositeStyles.json')).json();
		globalState.currentProject = {
			projectEditorState: new ProjectEditorState(),
			content: new ProjectContent()
		} as never;
		const rotation = new Style(
			(compositeDefinitions as Partial<Style>[]).find((style) => style.id === 'rotation')
		);
		const history = vi.spyOn(ProjectHistoryManager, 'track');
		const preview = render(CompositeText, {
			compositeStyle: new Style({ valueType: 'composite', value: [rotation] }),
			children: createRawSnippet(() => ({ render: () => '<span>Reciter name</span>' }))
		});
		const component = render(StyleComponent, {
			style: rotation,
			disabled: false,
			showControl: true,
			applyValueSimple: (value) => {
				rotation.value = value;
			}
		});
		const slider = component.container.querySelector<HTMLInputElement>('input[type="range"]')!;
		expect(slider.min).toBe('-180');
		expect(slider.max).toBe('180');
		expect(slider.step).toBe('1');
		slider.value = '-45';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(rotation.value).toBe(-45);
		expect(getComputedStyle(preview.container.querySelector('p')!).rotate).toBe('-45deg');
		expect(history).toHaveBeenCalledWith('set style value', expect.any(Function));
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

	test('keeps the bounded Z slider synchronized with context menu layer moves', async () => {
		const content = new ProjectContent();
		globalState.currentProject = {
			projectEditorState: new ProjectEditorState(),
			content
		} as never;
		const component = render(OverlayLayerControl, { layerId: 'arabic' });
		const slider = component.container.querySelector<HTMLInputElement>('input[type="range"]')!;
		expect(slider.min).toBe('1');
		expect(slider.value).toBe('2');
		slider.value = slider.max;
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(content.overlayLayerOrder.at(-1)).toBe('arabic');
		moveOverlayLayer('arabic', -1);
		await tick();
		expect(Number(slider.value)).toBe(Number(slider.max) - 1);
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
