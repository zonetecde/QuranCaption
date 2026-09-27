import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test } from 'vitest';

import TitleBar from '$lib/components/TitleBar.svelte';

describe('TitleBar direction', () => {
	afterEach(cleanup);

	test('keeps platform window controls in LTR order', () => {
		const component = render(TitleBar);

		expect(component.container.querySelector('header')?.getAttribute('dir')).toBe('ltr');
	});
});
