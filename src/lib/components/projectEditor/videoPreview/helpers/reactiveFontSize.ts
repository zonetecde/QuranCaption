/**
 * Ajustement réactif de la taille de police des sous-titres.
 *
 * Quand un sous-titre dépasse une hauteur maximale configurée (`max-height`),
 * la taille de police est réduite progressivement jusqu'à ce que le texte
 * tienne dans la hauteur souhaitée. Une marge supplémentaire est ajoutée
 * si le texte n'est pas centré verticalement (pour compenser les dépassements
 * liés au positionnement).
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
 * @param initialFontSize - Taille de police initiale en pixels.
 * @param isVerticalPosCentered - Si le texte est centré verticalement.
 * @param abortSignal - Signal pour annuler l'opération.
 * @param setReactiveFontSize - Callback pour appliquer la nouvelle taille.
 * @param wait - Fonction d'attente asynchrone (cède au navigateur).
 */
export async function applyReactiveFontSize(
	target: string,
	maxHeightValue: number,
	initialFontSize: number,
	isVerticalPosCentered: boolean,
	abortSignal: AbortSignal,
	setReactiveFontSize: (target: string, value: number) => void,
	wait: (signal: AbortSignal) => Promise<void>
): Promise<void> {
	// Si max-height vaut 0, aucune contrainte de hauteur
	if (maxHeightValue === 0) {
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
		while (subtitle.scrollHeight > maxHeightValue + marge && fontSize > 1) {
			if (abortSignal.aborted) return;

			// Réduction progressive d'environ 5%
			fontSize -= fontSize / 20;

			setReactiveFontSize(target, fontSize);
			await wait(abortSignal);
		}
	}
}
