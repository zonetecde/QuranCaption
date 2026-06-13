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

	// Applique la taille initiale comme point de départ
	setReactiveFontSize(target, initialFontSize);
	await wait(abortSignal);

	// Marge supplémentaire si le texte n'est pas centré verticalement
	// (évite un bug où le texte en bas/droite dépasse légèrement)
	const marge = isVerticalPosCentered ? 0 : 10;
	const subtitles = Array.from(document.querySelectorAll('.' + CSS.escape(target) + '.subtitle'));

	if (
		subtitles.length === 0 ||
		!hasReactiveFontSizeViolation(subtitles, target, maxHeightValue, maxLineValue, marge)
	) {
		return;
	}

	let minPassingSize = 1;
	let maxFailingSize = initialFontSize;

	for (let iteration = 0; iteration < 8; iteration++) {
		if (abortSignal.aborted) return;

		const nextFontSize = (minPassingSize + maxFailingSize) / 2;

		setReactiveFontSize(target, nextFontSize);
		await wait(abortSignal);

		if (hasReactiveFontSizeViolation(subtitles, target, maxHeightValue, maxLineValue, marge)) {
			maxFailingSize = nextFontSize;
		} else {
			minPassingSize = nextFontSize;
		}
	}

	setReactiveFontSize(target, Math.max(1, minPassingSize));
	await wait(abortSignal);
}

/**
 * Indique si au moins un sous-titre visible dépasse les contraintes de layout.
 *
 * @param subtitles - Éléments de sous-titre mesurés.
 * @param target - Target de style mesurée.
 * @param maxHeightValue - Hauteur maximale autorisée en pixels.
 * @param maxLineValue - Nombre maximal de lignes autorisées.
 * @param marge - Marge de tolérance verticale.
 * @returns `true` si une contrainte est dépassée.
 */
function hasReactiveFontSizeViolation(
	subtitles: Element[],
	target: string,
	maxHeightValue: number,
	maxLineValue: number,
	marge: number
): boolean {
	const hasMaxLineLimit = maxLineValue >= 1 && maxLineValue <= 4;

	return subtitles.some((subtitle) => {
		return (
			(maxHeightValue > 0 && subtitle.scrollHeight > maxHeightValue + marge) ||
			(hasMaxLineLimit && getReactiveFontSizeLineCount(subtitle, target) > maxLineValue)
		);
	});
}

/**
 * Compte les lignes réellement rendues dans un élément.
 *
 * @param element - Élément dont le contenu texte doit être mesuré.
 * @returns Nombre de lignes visibles après layout.
 */
export function getRenderedLineCount(element: Element): number {
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

	if (!element.textContent?.trim()) return 0;

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
 * Retourne le compteur de lignes adapté au type de sous-titre.
 *
 * @param element - Élément dont le contenu texte doit être mesuré.
 * @param target - Target de style mesurée.
 * @returns Nombre de lignes à utiliser pour l'ajustement de taille.
 */
function getReactiveFontSizeLineCount(element: Element, target: string): number {
	if (target === 'arabic') return getRenderedLineCount(element);
	if (!element.textContent?.trim()) return 0;

	return getFallbackLineCount(element);
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
