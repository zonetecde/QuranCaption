type TextTokenRect = {
	start: number;
	end: number;
	rect: DOMRect;
};

export type TextLineRect = {
	start: number;
	end: number;
	rect: DOMRect;
};

/**
 * Reproduit le comportement de `text-transform` pour le texte capture.
 * @param {string} text Texte source.
 * @param {string} transform Valeur CSS `text-transform`.
 * @returns {string} Texte transforme.
 */
export function applyTextTransform(text: string, transform: string): string {
	if (transform === 'uppercase') return text.toUpperCase();
	if (transform === 'lowercase') return text.toLowerCase();
	if (transform === 'capitalize') {
		return text.replace(/\b\S/g, (char) => char.toUpperCase());
	}
	return text;
}

/**
 * Decoupe un intervalle texte en bornes de graphemes.
 * @param {string} text Texte source complet.
 * @param {number} start Debut de l'intervalle.
 * @param {number} end Fin de l'intervalle.
 * @returns {Array<{ start: number; end: number }>} Bornes de graphemes dans le texte source.
 */
function getGraphemeRanges(
	text: string,
	start: number,
	end: number
): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const slicedText = text.slice(start, end);
	const segmenter =
		'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

	if (segmenter) {
		for (const { segment, index } of segmenter.segment(slicedText)) {
			ranges.push({
				start: start + index,
				end: start + index + segment.length
			});
		}
		return ranges;
	}

	let offset = start;
	for (const grapheme of Array.from(slicedText)) {
		const nextOffset = offset + grapheme.length;
		ranges.push({ start: offset, end: nextOffset });
		offset = nextOffset;
	}

	return ranges;
}

/**
 * Extrait les bornes de chaque token visible pour reconstruire les lignes.
 * @param {string} text Texte brut.
 * @returns {Array<{ start: number; end: number }>} Tableau des bornes de tokens.
 */
function getTextTokenRanges(text: string): Array<{ start: number; end: number }> {
	const tokens: Array<{ start: number; end: number }> = [];
	const tokenPattern = /\S+\s*/g;
	let match: RegExpExecArray | null;

	while ((match = tokenPattern.exec(text)) !== null) {
		tokens.push({
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return tokens;
}

/**
 * Calcule un identifiant de ligne stable base sur la position verticale.
 * @param {DOMRect} rect Rectangle du token.
 * @param {number} rootScaleY Echelle verticale locale.
 * @returns {number} Bucket de ligne.
 */
function getLineBucket(rect: DOMRect, rootScaleY: number): number {
	return Math.round(rect.top * rootScaleY);
}

/**
 * Reconstruit des lignes de texte depuis les rects DOM de tokens.
 * @param {Text} textNode Noeud texte source.
 * @param {number} rootScaleY Echelle verticale locale.
 * @param {boolean} separateWords Conserve la position de chaque mot pour le texte justifié.
 * @returns {TextLineRect[]} Liste des lignes detectees.
 */
export function getTextLineRects(
	textNode: Text,
	rootScaleY: number,
	separateWords = false
): TextLineRect[] {
	const tokenRects: TextTokenRect[] = [];

	for (const token of getTextTokenRanges(textNode.data)) {
		const range = document.createRange();
		range.setStart(textNode, token.start);
		range.setEnd(textNode, token.end);
		const rects = Array.from(range.getClientRects());
		range.detach();
		const lineCount = new Set(rects.map((rect) => getLineBucket(rect, rootScaleY))).size;

		if (lineCount > 1) {
			for (const grapheme of getGraphemeRanges(textNode.data, token.start, token.end)) {
				const graphemeRange = document.createRange();
				graphemeRange.setStart(textNode, grapheme.start);
				graphemeRange.setEnd(textNode, grapheme.end);
				const graphemeRects = Array.from(graphemeRange.getClientRects());
				graphemeRange.detach();

				for (const rect of graphemeRects) {
					if (!rect.width || !rect.height) continue;
					tokenRects.push({ ...grapheme, rect });
				}
			}
			continue;
		}

		for (const rect of rects) {
			if (!rect.width || !rect.height) continue;
			tokenRects.push({ ...token, rect });
		}
	}

	if (separateWords) return tokenRects;

	const lineGroups = new Map<number, TextTokenRect[]>();
	for (const tokenRect of tokenRects) {
		const bucket = getLineBucket(tokenRect.rect, rootScaleY);
		const group = lineGroups.get(bucket);
		if (group) group.push(tokenRect);
		else lineGroups.set(bucket, [tokenRect]);
	}

	return Array.from(lineGroups.values()).map((group) => {
		const start = Math.min(...group.map((token) => token.start));
		const end = Math.max(...group.map((token) => token.end));
		const left = Math.min(...group.map((token) => token.rect.left));
		const right = Math.max(...group.map((token) => token.rect.right));
		const top = Math.min(...group.map((token) => token.rect.top));
		const bottom = Math.max(...group.map((token) => token.rect.bottom));

		return {
			start,
			end,
			rect: new DOMRect(left, top, right - left, bottom - top)
		};
	});
}
