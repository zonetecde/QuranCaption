import {
	createContext,
	destroyContext,
	domToBlob,
	type Context,
	type Options
} from 'modern-screenshot';

let context: Context<HTMLElement> | null = null;
let contextKey = '';
let captureCount = 0;

/**
 * Libère le contexte et les caches du renderer de capture courant.
 * @returns {void} Rien.
 */
export function releaseExportScreenshotContext(): void {
	if (context) destroyContext(context);
	context = null;
	contextKey = '';
	captureCount = 0;
}

/**
 * Réutilise le contexte et les polices entre les captures d'un même worker.
 * @param {HTMLElement} node Racine DOM de l'overlay.
 * @param {Pick<Options, 'width' | 'height' | 'scale' | 'quality' | 'style' | 'onCloneNode'>} options Dimensions, échelle et traitement du clone.
 * @param {Record<string, number>} [timings] Durées des étapes de capture en millisecondes.
 * @returns {Promise<Blob>} PNG de l'overlay courant.
 */
export async function captureExportOverlayBlob(
	node: HTMLElement,
	options: Pick<Options, 'width' | 'height' | 'scale' | 'quality' | 'style' | 'onCloneNode'>,
	timings?: Record<string, number>
): Promise<Blob> {
	const key = JSON.stringify({ ...options, onCloneNode: undefined });
	if (context && (context.node !== node || contextKey !== key)) releaseExportScreenshotContext();
	if (!context) {
		context = await createContext(node, { ...options, autoDestruct: false });
		contextKey = key;
	}
	context.onCloneNode = options.onCloneNode ?? null;
	// modern-screenshot modifie ces styles pendant le clonage et conserve le dernier parent.
	context.defaultComputedStyles.clear();
	context.currentNodeStyle = undefined;
	context.currentParentNodeStyle = undefined;
	context.fontFamilies.clear();
	context.shadowRoots.length = 0;
	const log = context.log;
	if (timings) {
		const starts = new Map<string, number>();
		// Mesurer les étapes existantes sans activer les logs console de modern-screenshot.
		context.log = {
			...log,
			time: (label) => starts.set(label, performance.now()),
			timeEnd: (label) => {
				const started = starts.get(label);
				if (started !== undefined) timings[label] = Math.round(performance.now() - started);
			}
		};
	}
	try {
		return await domToBlob(context);
	} catch (error) {
		releaseExportScreenshotContext();
		throw error;
	} finally {
		if (context) {
			context.log = log;
			// Les images et les sous-ensembles système dépendent du texte de la frame courante.
			for (const [url, request] of context.requests) {
				if (request.type === 'image') context.requests.delete(url);
			}
			for (const rule of context.fontCssTexts.keys()) {
				if (rule.includes('data:')) context.fontCssTexts.delete(rule);
			}
			// Borner les caches de polices sur les exports longs, sans les recréer à chaque image.
			if (++captureCount % 64 === 0) releaseExportScreenshotContext();
		}
	}
}
