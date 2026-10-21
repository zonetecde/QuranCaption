const ARABIC_MARKS = '[\\p{M}\\u0640]*';

/**
 * Tolère les voyelles, le tatweel et les variantes orthographiques courantes d'un mot.
 * @param {string} word Mot arabe à reconnaître.
 * @returns {string} Motif Unicode sans groupe capturant.
 */
function arabicWord(word: string): string {
	return (
		[...word]
			.map((letter) => (letter === 'ى' ? '[ىي]' : letter === 'ة' ? '[ةه]' : letter))
			.join(ARABIC_MARKS) + ARABIC_MARKS
	);
}

const SALAWAT = new RegExp(
	`(?<![\\p{L}\\p{N}])(و?)(?:${arabicWord('صلى')}\\s+${arabicWord('الله')}\\s+${arabicWord('عليه')}\\s+${arabicWord('و')}\\s*${arabicWord('سلم')}|${arabicWord('عليه')}\\s+(?:${arabicWord('ال')})?${arabicWord('صلاة')}\\s+${arabicWord('و')}\\s*(?:${arabicWord('ال')})?${arabicWord('سلام')})(?![\\p{L}\\p{N}])`,
	'gu'
);

/**
 * Remplace les formules complètes à l'affichage en conservant les segments source.
 * Les segments Quran sont protégés. Avec un séparateur, la ponctuation reste attachée aux mots.
 * @param {T[]} segments Segments visuels ou mots chronométrés.
 * @param {(parts: T[], text: string) => T} merge Fusion des styles ou timings d'une formule.
 * @param {string} separator Séparateur entre unités, vide pour les spans et espace pour le WBW.
 * @returns {T[]} Segments affichés, sans mutation des données d'origine.
 */
export function collapseSalawatDisplaySegments<T extends { text: string; referenceType?: string }>(
	segments: T[],
	merge: (parts: T[], text: string) => T,
	separator = ''
): T[] {
	const text = segments
		.map((part) => (part.referenceType === 'quran' ? '\uFFFC'.repeat(part.text.length) : part.text))
		.join(separator);
	const matches = [...text.matchAll(SALAWAT)];
	if (matches.length === 0) return segments;
	let offset = 0;
	const positions = segments.map((part) => {
		const start = offset;
		offset += part.text.length + separator.length;
		return { part, start, end: start + part.text.length };
	});
	const output: T[] = [];
	/**
	 * Recopie une plage inchangée avec ses styles d'origine.
	 * @param {number} start Début inclus.
	 * @param {number} end Fin exclue.
	 * @returns {void}
	 */
	function appendOriginal(start: number, end: number): void {
		for (const position of positions) {
			const left = Math.max(start, position.start);
			const right = Math.min(end, position.end);
			if (left < right)
				output.push({
					...position.part,
					text: position.part.text.slice(left - position.start, right - position.start)
				});
		}
	}
	let cursor = 0;
	for (const match of matches) {
		const from = match.index;
		const to = from + match[0].length;
		const covered = positions.filter((position) => position.end > from && position.start < to);
		const start = separator ? covered[0].start : from;
		const end = separator ? covered[covered.length - 1].end : to;
		if (start < cursor) continue;
		appendOriginal(cursor, start);
		output.push(
			merge(
				covered.map((position) => position.part),
				`${text.slice(start, from)}${match[1]}ﷺ${text.slice(to, end)}`
			)
		);
		cursor = end;
	}
	appendOriginal(cursor, text.length);
	return output;
}
