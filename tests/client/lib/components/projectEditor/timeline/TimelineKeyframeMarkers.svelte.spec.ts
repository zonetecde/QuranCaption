import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test } from 'vitest';

import TimelineKeyframeMarkers from '$lib/components/projectEditor/timeline/TimelineKeyframeMarkers.svelte';

describe('timeline keyframe markers', () => {
	afterEach(cleanup);

	test('positions one lozenge for each keyframe on the ruler', () => {
		const component = render(TimelineKeyframeMarkers, {
			times: [1000, 2500],
			zoom: 20,
			offset: 180
		});
		const markers = component.container.querySelectorAll<HTMLElement>('[data-keyframe-marker]');

		expect(markers).toHaveLength(2);
		expect(markers[0].style.left).toBe('200px');
		expect(markers[1].style.left).toBe('230px');
	});
});
