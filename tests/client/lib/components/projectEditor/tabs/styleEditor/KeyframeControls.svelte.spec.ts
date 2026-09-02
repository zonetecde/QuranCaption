import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import KeyframeControls from '$lib/components/projectEditor/tabs/styleEditor/KeyframeControls.svelte';

describe('keyframe controls', () => {
	afterEach(cleanup);

	test('exposes previous, toggle and next actions around an active diamond', async () => {
		const onPrevious = vi.fn();
		const onToggle = vi.fn();
		const onNext = vi.fn();
		const component = render(KeyframeControls, {
			active: true,
			hasPrevious: true,
			hasNext: true,
			onPrevious,
			onToggle,
			onNext
		});

		const buttons = component.container.querySelectorAll<HTMLButtonElement>('button');
		expect(buttons).toHaveLength(3);
		expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
		await buttons[0].click();
		await buttons[1].click();
		await buttons[2].click();

		expect(onPrevious).toHaveBeenCalledOnce();
		expect(onToggle).toHaveBeenCalledOnce();
		expect(onNext).toHaveBeenCalledOnce();
	});

	test('hides unavailable navigation and renders a geometric lozenge', () => {
		const component = render(KeyframeControls, {
			active: false,
			hasPrevious: false,
			hasNext: false,
			onPrevious: vi.fn(),
			onToggle: vi.fn(),
			onNext: vi.fn()
		});
		const controls = component.container.querySelector<HTMLElement>('[data-keyframe-controls]')!;
		const toggle = component.container.querySelector<HTMLElement>('.keyframe-toggle')!;

		expect(component.container.querySelectorAll('button')).toHaveLength(1);
		expect(component.container.querySelector('.keyframe-lozenge')).not.toBeNull();
		expect(component.container.querySelector('.material-icons')).toBeNull();
		expect(controls).toHaveClass('keyframe-controls-empty');
		expect(getComputedStyle(toggle).opacity).toBe('0.4');
		expect(getComputedStyle(controls).borderTopColor).toBe('rgba(0, 0, 0, 0)');
	});
});
