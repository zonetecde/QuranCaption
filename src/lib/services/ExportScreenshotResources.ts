import type { Context as ScreenshotContext } from 'modern-screenshot';

/**
 * Libère les pixels et les images mises en cache après une capture d'export.
 * @param {HTMLCanvasElement | null} canvas Canvas produit par la capture, s'il existe.
 * @param {Pick<ScreenshotContext<HTMLElement>, 'requests'> | null} context Contexte réutilisable de la capture, s'il existe.
 * @returns {void} Rien.
 */
export function releaseExportScreenshotResources(
	canvas: HTMLCanvasElement | null,
	context: Pick<ScreenshotContext<HTMLElement>, 'requests'> | null
): void {
	if (canvas) {
		canvas.width = 0;
		canvas.height = 0;
	}
	if (context) {
		for (const [url, request] of context.requests) {
			if (request.type === 'image') context.requests.delete(url);
		}
	}
}
