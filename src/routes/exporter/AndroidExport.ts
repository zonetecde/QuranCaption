import { domToForeignObjectSvg, type Context } from 'modern-screenshot';

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
				rule.cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (_, _quote, source: string) => {
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
 * Prépare le DOM existant pour la WebView native, sans sérialiser les fichiers de polices.
 * @param {Context<HTMLElement>} context Contexte de clonage avec l'option font désactivée.
 * @returns {Promise<{html: string; fontCss: string[]}>} Overlay et règles des polices utilisées.
 */
export async function prepareAndroidOverlay(
	context: Context<HTMLElement>
): Promise<{ html: string; fontCss: string[] }> {
	context.fontFamilies.clear();
	context.shadowRoots.length = 0;
	context.svgStyles.clear();
	context.svgDefsElement?.replaceChildren();
	if (context.svgStyleElement) {
		context.svgStyleElement.textContent =
			'.______background-clip--text{background-clip:text;-webkit-background-clip:text}';
	}
	const svg = await domToForeignObjectSvg(context);
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
	return { html: svg.outerHTML, fontCss: Array.from(fontCss) };
}
