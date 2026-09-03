import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import ColorControl from '$lib/components/projectEditor/tabs/styleEditor/controls/ColorControl.svelte';

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	toastLoading: vi.fn().mockReturnValue('capture-toast'),
	toastDismiss: vi.fn(),
	beginStyleMutation: vi.fn(),
	commitStyleMutation: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('svelte-5-french-toast', () => ({
	default: { loading: mocks.toastLoading, dismiss: mocks.toastDismiss }
}));
vi.mock('$lib/services/StyleMutationService', () => ({
	beginStyleMutation: mocks.beginStyleMutation,
	commitStyleMutation: mocks.commitStyleMutation
}));

describe('screen color picker', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	test('shows a bottom-left toast while the native capture is loading', async () => {
		let resolveCapture: ((bytes: number[]) => void) | undefined;
		mocks.invoke.mockReturnValue(
			new Promise<number[]>((resolve) => {
				resolveCapture = resolve;
			})
		);
		const component = render(ColorControl, { value: '#ffffff', onChange: vi.fn() });
		const button = component.container.querySelector<HTMLButtonElement>('.style-eyedropper')!;

		button.click();

		await vi.waitFor(() => expect(button.disabled).toBe(true));
		expect(mocks.toastLoading).toHaveBeenCalledWith(expect.any(String), {
			position: 'bottom-left'
		});

		resolveCapture?.([255, 216, 255, 224]);
		await vi.waitFor(() => {
			expect(document.body.querySelector('.screen-color-picker')).not.toBeNull();
		});
		expect(mocks.toastDismiss).toHaveBeenCalledWith('capture-toast');
	});

	test('applies the pixel clicked in the native window capture', async () => {
		mocks.invoke.mockResolvedValue([255, 216, 255, 224]);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:window-capture');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
			drawImage: vi.fn(),
			getImageData: vi.fn().mockReturnValue({
				data: new Uint8ClampedArray([18, 52, 86, 255])
			})
		} as never);
		const onChange = vi.fn();
		const component = render(ColorControl, { value: '#ffffff', onChange });

		await component.container.querySelector<HTMLButtonElement>('.style-eyedropper')!.click();
		const picker = await vi.waitFor(() => {
			const overlay = document.body.querySelector<HTMLButtonElement>('.screen-color-picker');
			expect(overlay?.parentElement).toBe(document.body);
			return overlay!;
		});
		const image = picker.querySelector('img')!;
		Object.defineProperties(image, {
			naturalWidth: { value: 100 },
			naturalHeight: { value: 50 }
		});
		vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
			left: 10,
			top: 20,
			width: 200,
			height: 100,
			right: 210,
			bottom: 120,
			x: 10,
			y: 20,
			toJSON: () => ({})
		});

		picker.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 70 }));

		await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('#123456'));
		expect(mocks.invoke).toHaveBeenCalledWith('capture_screen_for_color_picker');
		expect(mocks.beginStyleMutation).toHaveBeenCalledOnce();
		expect(mocks.commitStyleMutation).toHaveBeenCalledOnce();
		expect(document.body.querySelector('.screen-color-picker')).toBeNull();
	});
});
