import { describe, expect, it } from 'vitest';
import { releaseExportScreenshotResources } from '$lib/services/ExportScreenshotResources';

describe('releaseExportScreenshotResources', () => {
	it('libère les pixels et évite que le cache d’images grandisse au fil des captures', () => {
		const requests = new Map<string, { type: 'image' | 'text'; response: Promise<string> }>();
		requests.set('font', { type: 'text', response: Promise.resolve('font data') });

		for (let frame = 0; frame < 64; frame++) {
			const canvas = document.createElement('canvas');
			canvas.width = 1920;
			canvas.height = 1080;
			canvas.getContext('2d')?.fillRect(0, 0, 1, 1);
			requests.set(`image-${frame}`, {
				type: 'image',
				response: Promise.resolve('data:image/png;base64,AAAA')
			});

			releaseExportScreenshotResources(canvas, { requests });

			expect(canvas.width).toBe(0);
			expect(canvas.height).toBe(0);
			expect(requests.size).toBe(1);
			expect(requests.has('font')).toBe(true);
		}
	});
});
