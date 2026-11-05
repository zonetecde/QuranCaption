import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Asset } from '$lib/classes';
import PreviewBackgroundMedia from '$lib/components/projectEditor/videoPreview/PreviewBackgroundMedia.svelte';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => path }));

const props = {
	video: { filePath: '/silent.ogg', mediaReloadToken: 0 } as Asset,
	image: null,
	loop: false,
	style: '',
	opacity: 1,
	showCrossfadeNotice: false,
	crossfadeNotice: '',
	onVideoEnded: vi.fn()
};

describe('preview background visibility', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	test('does not load disabled video and releases it when disabled again', async () => {
		const component = render(PreviewBackgroundMedia, { ...props, enabled: false });
		expect(component.container.querySelector('video')).toBeNull();

		await component.rerender({ enabled: true });
		const video = component.container.querySelector('video')!;
		expect(video.getAttribute('src')).toBe('/silent.ogg?v=0');
		const pause = vi.spyOn(video, 'pause');
		const load = vi.spyOn(video, 'load');

		await component.rerender({ enabled: false });
		expect(component.container.querySelector('video')).toBeNull();
		expect(pause).toHaveBeenCalledOnce();
		expect(video.hasAttribute('src')).toBe(false);
		expect(load).toHaveBeenCalledOnce();
	});

	test('hides images and the transition notice with the preview background', async () => {
		const component = render(PreviewBackgroundMedia, {
			...props,
			video: null,
			image: { filePath: '/favicon.png', mediaReloadToken: 0 } as Asset,
			showCrossfadeNotice: true,
			crossfadeNotice: 'Transition',
			enabled: false
		});
		expect(component.container.querySelector('img')).toBeNull();
		expect(component.container.textContent).not.toContain('Transition');
		await component.rerender({ enabled: true });
		expect(component.container.querySelector('img')).not.toBeNull();
		expect(component.container.textContent).toContain('Transition');
	});
});
