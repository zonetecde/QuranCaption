import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import DimensionControl from '$lib/components/projectEditor/tabs/styleEditor/controls/DimensionControl.svelte';

describe('DimensionControl', () => {
	afterEach(cleanup);

	test('uses visual orientation and quality cards to apply portrait dimensions', async () => {
		const onChange = vi.fn();
		const component = render(DimensionControl, {
			value: { width: 1920, height: 1080 },
			onChange
		});

		await component.container
			.querySelector<HTMLButtonElement>('[data-orientation="portrait"]')!
			.click();
		await component.container.querySelector<HTMLButtonElement>('[data-quality="720p"]')!.click();
		await component.container.querySelector<HTMLButtonElement>('[data-apply-dimensions]')!.click();

		expect(onChange).toHaveBeenCalledWith({ width: 720, height: 1280 });
	});

	test('offers square and custom dimension cards', async () => {
		const onChange = vi.fn();
		const component = render(DimensionControl, {
			value: { width: 1920, height: 1080 },
			onChange
		});

		await component.container
			.querySelector<HTMLButtonElement>('[data-orientation="square"]')!
			.click();
		await component.container.querySelector<HTMLButtonElement>('[data-apply-dimensions]')!.click();
		expect(onChange).toHaveBeenCalledWith({ width: 1080, height: 1080 });

		await component.container
			.querySelector<HTMLButtonElement>('[data-orientation="custom"]')!
			.click();
		expect(component.container.querySelectorAll('[data-custom-dimension]')).toHaveLength(2);
	});
});
