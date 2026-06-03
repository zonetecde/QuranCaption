/**
 * Ajustement réactif de la taille de police des sous-titres.
 *
 * Quand un sous-titre dépasse une hauteur maximale configurée (`max-height`)
 * ou un nombre maximal de lignes (`max-line`), la taille de police est réduite
 * progressivement jusqu'à ce que le texte tienne dans la contrainte souhaitée.
 * Une marge supplémentaire est ajoutée si le texte n'est pas centré verticalement
 * (pour compenser les dépassements liés au positionnement).
 *
 * La réduction est progressive : à chaque itération, la taille est réduite
 * d'environ 5% (division par 20).
 */

/**
 * Applique l'ajustement réactif de taille de police pour un target donné.
 *
 * Pour chaque élément `.subtitle` du target visé, vérifie si sa hauteur
 * dépasse `maxHeightValue`. Si oui, réduit `fontSize` par paliers jusqu'à
 * ce que la contrainte soit respectée ou que la taille atteigne 1px.
 *
 * @param target - Le target de style (ex: `"arabic"`, nom d'édition).
 * @param maxHeightValue - Hauteur maximale autorisée en pixels (0 = pas de limite).
 * @param maxLineValue - Nombre maximal de lignes rendues (1-4 = limite, autre = pas de limite).
 * @param initialFontSize - Taille de police initiale en pixels.
 * @param isVerticalPosCentered - Si le texte est centré verticalement.
 * @param abortSignal - Signal pour annuler l'opération.
 * @param setReactiveFontSize - Callback pour appliquer la nouvelle taille.
 * @param wait - Fonction d'attente asynchrone (cède au navigateur).
 */
export async function applyReactiveFontSize(
	target: string,
	maxHeightValue: number,
	maxLineValue: number,
	initialFontSize: number,
	isVerticalPosCentered: boolean,
	abortSignal: AbortSignal,
	setReactiveFontSize: (target: string, value: number) => void,
	wait: (signal: AbortSignal) => Promise<void>
): Promise<void> {
	const hasMaxLineLimit = maxLineValue >= 1 && maxLineValue <= 4;

	// Si max-height vaut 0 et max-line est infini, aucune contrainte de fit
	if (maxHeightValue === 0 && !hasMaxLineLimit) {
		// On définit quand même la taille réactive pour rester cohérent
		setReactiveFontSize(target, initialFontSize);
		return;
	}

	let fontSize = initialFontSize;

	// Applique la taille initiale comme point de départ
	setReactiveFontSize(target, fontSize);
	await wait(abortSignal);

	// Marge supplémentaire si le texte n'est pas centré verticalement
	// (évite un bug où le texte en bas/droite dépasse légèrement)
	const marge = isVerticalPosCentered ? 0 : 10;

	const subtitles = document.querySelectorAll('.' + CSS.escape(target) + '.subtitle');

	for (const subtitle of subtitles) {
		if (abortSignal.aborted) return;

		// Réduit la police tant que la hauteur dépasse la limite
		while (
			((maxHeightValue > 0 && subtitle.scrollHeight > maxHeightValue + marge) ||
				(hasMaxLineLimit && getRenderedLineCount(subtitle) > maxLineValue)) &&
			fontSize > 1
		) {
			if (abortSignal.aborted) return;

			// Réduction progressive d'environ 5%
			fontSize -= fontSize / 20;

			setReactiveFontSize(target, fontSize);
			await wait(abortSignal);
		}
	}
}

/**
 * Compte les lignes réellement rendues dans un élément.
 *
 * @param element - Élément dont le contenu texte doit être mesuré.
 * @returns Nombre de lignes visibles après layout.
 */
export function getRenderedLineCount(element: Element): number {
	if (!element.textContent?.trim()) return 0;

	const range = document.createRange();
	range.selectNodeContents(element);

	try {
		if (typeof range.getClientRects === 'function') {
			const rects = Array.from(range.getClientRects()).filter(
				(rect) => rect.width > 0 && rect.height > 0
			);

			if (rects.length > 0) return countDistinctLinePositions(rects);
		}
	} finally {
		range.detach();
	}

	return getFallbackLineCount(element);
}

/**
 * Regroupe les rectangles DOM qui appartiennent à une même ligne visuelle.
 *
 * @param rects - Rectangles retournés par `Range.getClientRects()`.
 * @returns Nombre de positions verticales distinctes.
 */
function countDistinctLinePositions(rects: DOMRect[]): number {
	const lineCenters: number[] = [];

	for (const rect of rects) {
		const centerY = (rect.top + rect.bottom) / 2;
		if (!lineCenters.some((lineCenter) => Math.abs(lineCenter - centerY) <= 1)) {
			lineCenters.push(centerY);
		}
	}

	return lineCenters.length;
}

/**
 * Estime le nombre de lignes si l'API Range ne fournit pas de rectangles.
 *
 * @param element - Élément mesuré.
 * @returns Nombre de lignes estimé depuis `scrollHeight` et `line-height`.
 */
function getFallbackLineCount(element: Element): number {
	const style = window.getComputedStyle(element);
	const lineHeight = Number.parseFloat(style.lineHeight);
	const fontSize = Number.parseFloat(style.fontSize);
	const effectiveLineHeight = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2;

	if (!Number.isFinite(effectiveLineHeight) || effectiveLineHeight <= 0) return 0;

	return Math.ceil((element as HTMLElement).scrollHeight / effectiveLineHeight);
}
