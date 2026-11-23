import { domToCanvas, domToForeignObjectSvg, type Context } from 'modern-screenshot';
import { releaseExportScreenshotResources } from '$lib/services/ExportScreenshotResources';
import { refreshRoundedTextOutlines } from '$lib/services/RoundedTextOutline';

const cssUrl = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

/**
 * Prépare au plus une capture en avance et attend les écritures avant de terminer.
 * @param {readonly T[]} jobs Captures à exécuter dans l'ordre.
 * @param {(job: T, onPrepared: () => void) => Promise<R>} capture Capture signalant quand son DOM est indépendant de la preview.
 * @param {((result: R, job: T, index: number) => void | Promise<void>) | undefined} onCaptured Progression après l'écriture, dans l'ordre des jobs.
 * @returns {Promise<void>} Résolution après toutes les captures, ou première erreur.
 */
export async function runAndroidCapturePipeline<T, R>(
	jobs: readonly T[],
	capture: (job: T, onPrepared: () => void) => Promise<R>,
	onCaptured?: (result: R, job: T, index: number) => void | Promise<void>
): Promise<void> {
	let pending: Promise<void> | undefined;
	let failure: { error: unknown } | undefined;
	try {
		for (const [index, job] of jobs.entries()) {
			if (failure) throw failure.error;
			const previous = pending;
			let onPrepared!: () => void;
			const prepared = new Promise<void>((resolve) => (onPrepared = resolve));
			const current = capture(job, onPrepared).then(async (result) => {
				await previous;
				await onCaptured?.(result, job, index);
			});
			// Une écriture peut échouer pendant que la préparation suivante occupe le JavaScript.
			void current.catch((error) => {
				failure ??= { error };
			});
			await Promise.race([prepared, current]);
			pending = current;
			await previous;
		}
		await pending;
	} finally {
		// Aucun fichier ne doit encore être écrit quand l'export lance son nettoyage.
		await pending?.catch(() => {});
	}
}

/**
 * Collecte les règles des polices utilisées en conservant leurs URL originales.
 * @param {CSSRuleList} rules Règles de la feuille courante.
 * @param {string} baseUrl URL servant à résoudre les sources relatives.
 * @param {Map<string, Set<string>>} families Familles présentes dans l'overlay cloné.
 * @param {Set<string>} result Règles uniques à charger dans le renderer natif.
 * @returns {void}
 */
function collectFontRules(
	rules: CSSRuleList,
	baseUrl: string,
	families: Map<string, Set<string>>,
	result: Set<string>
): void {
	for (const rule of Array.from(rules)) {
		if (rule instanceof CSSFontFaceRule) {
			const family = rule.style
				.getPropertyValue('font-family')
				.replace(/^['"]|['"]$/g, '')
				.toLowerCase();
			if (!families.has(family)) continue;
			result.add(
				rule.cssText.replace(cssUrl, (_, _quote, source: string) => {
					return `url(${JSON.stringify(new URL(source, baseUrl).href)})`;
				})
			);
		} else if (rule instanceof CSSImportRule) {
			try {
				if (rule.styleSheet)
					collectFontRules(rule.styleSheet.cssRules, rule.href, families, result);
			} catch {
				// Les feuilles Google Fonts peuvent refuser l'accès à leur CSSOM.
				const url = new URL(rule.href, baseUrl);
				if (
					url.hostname === 'fonts.googleapis.com' &&
					!url.searchParams
						.getAll('family')
						.some((family) => families.has(family.split(':')[0].toLowerCase()))
				) {
					continue;
				}
				result.add(`@import url(${JSON.stringify(rule.href)});`);
			}
		} else if ('cssRules' in rule) {
			collectFontRules((rule as CSSGroupingRule).cssRules, baseUrl, families, result);
		}
	}
}

/**
 * Prépare une copie indépendante du DOM pour la capture, avec les règles de police utilisées.
 * @param {Context<HTMLElement>} context Contexte de clonage avec l'option font désactivée.
 * @returns {Promise<{svg: SVGElement; fontCss: string[]}>} Overlay et règles des polices utilisées.
 */
export async function prepareAndroidOverlay(
	context: Context<HTMLElement>
): Promise<{ svg: SVGElement; fontCss: string[] }> {
	refreshRoundedTextOutlines(context.node);
	context.fontFamilies.clear();
	context.shadowRoots.length = 0;
	context.svgStyles.clear();
	context.svgDefsElement?.replaceChildren();
	if (context.svgStyleElement) {
		context.svgStyleElement.textContent =
			'.______background-clip--text{background-clip:text;-webkit-background-clip:text}';
	}
	const svg = await domToForeignObjectSvg(context);
	// Le dessin logiciel Android déforme les glyphes sous un transform de mise à l'échelle.
	// Le zoom conserve les positions et applique l'échelle au layout du texte.
	const root = svg.querySelector<HTMLElement>('foreignObject > *')!;
	root.style.transform = 'none';
	root.style.zoom = String(context.width / context.node.clientWidth);
	// Le flou du fond vidéo est appliqué par FFmpeg ; les backdrop-filters étaient ignorés
	// par la capture SVG et déforment le dessin bitmap de la WebView Android.
	for (const element of svg.querySelectorAll<HTMLElement>('[style]')) {
		if (element.style.backdropFilter) element.style.backdropFilter = 'none';
		// Même neutre, ce filtre masque les mots voisins d'un halo au dessin bitmap Android.
		if (
			element.matches('p.arabic') &&
			element.style.filter === 'blur(0px) brightness(1) contrast(1)'
		) {
			element.style.filter = 'none';
		}
	}
	const fontCss = new Set<string>();
	const document = context.node.ownerDocument;
	// La préparation suivante peut réutiliser ces nœuds pendant la rasterisation du SVG.
	for (const element of [context.svgStyleElement, context.svgDefsElement]) {
		element?.replaceWith(element.cloneNode(true));
	}
	for (const sheet of Array.from(document.styleSheets)) {
		try {
			collectFontRules(
				sheet.cssRules,
				sheet.href || document.baseURI,
				context.fontFamilies,
				fontCss
			);
		} catch {
			if (sheet.href) fontCss.add(`@import url(${JSON.stringify(sheet.href)});`);
		}
	}
	return { svg, fontCss: Array.from(fontCss) };
}

/**
 * Charge une ressource de police requise par l'image SVG isolée.
 * @param {string} url URL de la ressource.
 * @returns {Promise<Response>} Réponse utilisable.
 */
async function fetchOverlayFont(url: string): Promise<Response> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Overlay font download failed: ${response.status} (${url})`);
	return response;
}

/**
 * Incorpore les fichiers de police dans une règle CSS pour le rendu SVG en image.
 * @param {string} css Règle ou feuille de style à incorporer.
 * @param {Map<string, Promise<string>>} fontCache Fichiers de police déjà chargés pendant l'export.
 * @param {string} baseUrl URL servant à résoudre les sources relatives.
 * @returns {Promise<string>} CSS autonome.
 */
async function embedOverlayFontCss(
	css: string,
	fontCache: Map<string, Promise<string>>,
	baseUrl: string
): Promise<string> {
	const matches = Array.from(css.matchAll(cssUrl));
	if (css.startsWith('@import') && matches[0]) {
		const url = new URL(matches[0][2], baseUrl).href;
		return embedOverlayFontCss(await (await fetchOverlayFont(url)).text(), fontCache, url);
	}
	const dataUrls = await Promise.all(
		matches.map(async ([, , source]) => {
			const url = new URL(source, baseUrl).href;
			if (url.startsWith('data:')) return url;
			let dataUrl = fontCache.get(url);
			if (!dataUrl) {
				dataUrl = fetchOverlayFont(url)
					.then((response) => response.blob())
					.then(
						(blob) =>
							new Promise<string>((resolve, reject) => {
								const reader = new FileReader();
								reader.onload = () => resolve(String(reader.result));
								reader.onerror = () => reject(reader.error);
								reader.readAsDataURL(blob);
							})
					);
				fontCache.set(url, dataUrl);
			}
			return dataUrl;
		})
	);
	let index = 0;
	return css.replace(cssUrl, () => `url(${JSON.stringify(dataUrls[index++])})`);
}

/**
 * Rasterise le SVG en PNG sans passer par le dessin logiciel de la WebView Android.
 * @param {Awaited<ReturnType<typeof prepareAndroidOverlay>>} overlay Overlay indépendant à rasteriser.
 * @param {number} width Largeur finale du PNG.
 * @param {number} height Hauteur finale du PNG.
 * @param {Map<string, Promise<string>>} fontCache Fichiers de police de l'export.
 * @returns {Promise<Blob>} PNG transparent.
 */
export async function rasterizeAndroidOverlay(
	{ svg, fontCss }: Awaited<ReturnType<typeof prepareAndroidOverlay>>,
	width: number,
	height: number,
	fontCache: Map<string, Promise<string>>
): Promise<Blob> {
	const css = await Promise.all(
		fontCss.map((rule) => embedOverlayFontCss(rule, fontCache, svg.ownerDocument.baseURI))
	);
	svg.querySelector('style')!.append(css.join('\n'));
	const canvas = await domToCanvas(svg, { width, height, font: false });
	try {
		// La WebView masquée retarde l'encodage asynchrone de canvas.toBlob().
		return await (await fetch(canvas.toDataURL())).blob();
	} finally {
		releaseExportScreenshotResources(canvas, null);
	}
}
