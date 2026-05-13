/**
 * Fonctions utilitaires pour les crochets décoratifs qui encadrent
 * le texte arabe dans l'overlay vidéo.
 *
 * Les crochets sont des glyphes issus d'une police dédiée (QPC2BSML)
 * qui propose plusieurs paires décoratives (LM, NO, PQ, RS, TU, VW, XY, etc.).
 */

/**
 * Génère le CSS inline pour les crochets décoratifs.
 * Utilise la police QPC2BSML qui contient les glyphes décoratifs.
 * @returns CSS inline à appliquer aux `<span>` des crochets.
 */
export function getDecorativeBracketCss(): string {
	return "font-family: 'QPC2BSML', serif; display: inline-block;";
}

/**
 * Détermine la paire de glyphes (ouvrant/fermant) à utiliser pour les crochets décoratifs.
 * Parse la chaîne brute du style `decorative-brackets-font-family` (ex: "LM", "N O", "P/Q")
 * et retourne les deux caractères correspondants.
 *
 * @param rawPair - Valeur brute du style `decorative-brackets-font-family`.
 * @returns Un objet `{ opening, closing }` avec les glyphes ouvrant et fermant.
 */
export function getDecorativeBracketGlyphs(rawPair: string): { opening: string; closing: string } {
	// Nettoie la chaîne : supprime espaces, slashs et tirets
	const compact = rawPair.replaceAll(' ', '').replaceAll('/', '').replaceAll('-', '');
	const allowedPairs = ['LM', 'NO', 'PQ', 'RS', 'TU', 'VW', 'XY', 'Z:', '()'];

	if (allowedPairs.includes(compact) && compact.length >= 2) {
		return { opening: compact[0], closing: compact[1] };
	}

	// Paire par défaut : L et M
	return { opening: 'L', closing: 'M' };
}
