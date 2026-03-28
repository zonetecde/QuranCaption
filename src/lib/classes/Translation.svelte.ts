import { globalState } from '$lib/runes/main.svelte';
import type { SubtitleClip } from './Clip.svelte';
import type { Edition } from './Edition';
import { SerializableBase } from './misc/SerializableBase';

export type TranslationStatus =
	| 'completed by default'
	| 'automatically trimmed'
	| 'ai trimmed'
	| 'to review'
	| 'reviewed'
	| 'ai error'
	| 'fetched'
	| 'undefined';

export class Translation extends SerializableBase {
	// Le texte de la traduction
	text: string = $state('');

	// Status
	status: TranslationStatus = $state('undefined');

	// Type de la traduction
	type: 'verse' | 'predefined' | 'other' = 'other';

	constructor(text: string, status: TranslationStatus) {
		super();
		this.text = text;
		this.status = status;
	}

	isStatusComplete(): boolean {
		return (
			this.status === 'completed by default' ||
			this.status === 'reviewed' ||
			this.status === 'automatically trimmed' ||
			this.status === 'ai trimmed' ||
			this.status === 'fetched'
		);
	}

	getText(edition?: string, subtitle?: SubtitleClip): string {
		return this.text.replaceAll('— ', '—'); // Enlève l'espace après le tiret long qu'on a ajouté pour pouvoir sélectionner les mots avant et après le tiret
	}

	updateStatus(status: TranslationStatus, edition: Edition) {
		this.status = status;

		globalState.currentProject!.detail.updatePercentageTranslated(edition);
	}
}

export class VerseTranslation extends Translation {
	// L'indice du mot de début de la traduction dans le texte original
	startWordIndex: number = $state(0);

	// L'indice du mot de fin de la traduction dans le texte original
	endWordIndex: number = $state(0);

	// Indique si la traduction ne se base pas sur la traduction originale
	isBruteForce: boolean = $state(false);

	constructor(text: string, status: TranslationStatus) {
		super(text, status);

		if (text === undefined) return; // déserialisation

		this.startWordIndex = 0;
		this.endWordIndex = text.split(' ').length - 1;
		this.isBruteForce = false;
		this.type = 'verse';
	}

	/**
	 * Retourne le texte de la traduction en ajoutant le numéro de verset si demandé dans les styles
	 * @param edition L'édition de la traduction
	 * @param subtitle Le clip de sous-titre associé à la traduction
	 * @returns Le texte de la traduction avec le numéro de verset si demandé
	 */
	override getText(edition: string, subtitle: SubtitleClip): string {
		// Ajoute le numéro de verset si demandé dans les styles
		const position = globalState.getStyle(edition, 'verse-number-position').value;

		// Si on doit afficher le numéro de verset et que c'est le début ou la fin du verset (en fonction de où on veut l'afficher)
		if (
			((subtitle.startWordIndex === 0 && position === 'before') ||
				(subtitle.isLastWordsOfVerse && position === 'after')) &&
			globalState.getStyle(edition, 'show-verse-number').value
		) {
			// Le format contient par ex. `<number>. `
			let format: string = (
				globalState.getStyle(edition, 'verse-number-format').value as string
			).replace('<number>', subtitle.verse.toString());

			// Ajoute le texte de la traduction au bon endroit
			if (position === 'before' && subtitle.startWordIndex === 0) {
				format = format + super.getText();
			} else if (position === 'after' && subtitle.isLastWordsOfVerse) {
				format = super.getText() + format;
			} else {
				format = super.getText();
			}

			return format;
		}

		// Sinon, retourne juste le texte de la traduction
		return super.getText();
	}

	/**
	 * Recalcule les indexes de début et de fin de la traduction dans le texte original en fonction du texte actuel
	 */
	tryRecalculateTranslationIndexes(edition: Edition, verseKey: string): void {
		const originalTranslationText: string =
			globalState.currentProject!.content.projectTranslation.getVerseTranslation(edition, verseKey);

		if (!originalTranslationText) return;

		// Normalise un mot pour comparer les contenus sans être sensible à la casse,
		// aux espaces spéciaux, aux variantes de tirets et à la ponctuation de bord.
		const normalizeWord = (w: string) =>
			w
				.replace(/\u00A0/g, ' ')
				.normalize('NFKC')
				.toLowerCase()
				.replace(/[\u2013\u2014]/g, '-')
				.replace(/^([^\p{L}\p{N}]+)|([^\p{L}\p{N}]+)$/gu, '');

		// Découpe robuste en mots, sans produire [''] quand la chaîne est vide.
		const splitWords = (s: string) =>
			s
				.replace(/\u00A0/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.split(' ')
				.filter((w) => w.length > 0);

		type IndexedToken = { value: string; sourceWordIndex: number };
		type MatchCandidate = {
			tokenStart: number;
			tokenEnd: number;
			similarity: number;
		};

		// Transforme un texte en tokens normalisés tout en conservant l'index
		// du mot source. Les tokens vides (ex: ponctuation seule) sont ignorés.
		const toIndexedTokens = (text: string): IndexedToken[] =>
			splitWords(text)
				.map((word, sourceWordIndex) => ({
					value: normalizeWord(word),
					sourceWordIndex
				}))
				.filter((token) => token.value.length > 0);

		const normalizeTextForFuzzy = (text: string) =>
			text
				.replace(/\u00A0/g, ' ')
				.normalize('NFKC')
				.toLowerCase()
				.replace(/[\u2013\u2014]/g, '-')
				.replace(/\s*-\s*/g, '-')
				.replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
				.replace(/\s+/g, ' ')
				.trim();

		const levenshteinDistance = (left: string, right: string): number => {
			if (left === right) return 0;
			if (left.length === 0) return right.length;
			if (right.length === 0) return left.length;

			const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
			const current = new Array<number>(right.length + 1).fill(0);

			for (let i = 1; i <= left.length; i++) {
				current[0] = i;
				for (let j = 1; j <= right.length; j++) {
					const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
					current[j] = Math.min(
						current[j - 1] + 1,
						previous[j] + 1,
						previous[j - 1] + substitutionCost
					);
				}
				for (let j = 0; j <= right.length; j++) {
					previous[j] = current[j];
				}
			}

			return previous[right.length];
		};

		const getSimilarity = (left: string, right: string): number => {
			const normalizedLeft = normalizeTextForFuzzy(left);
			const normalizedRight = normalizeTextForFuzzy(right);
			if (!normalizedLeft || !normalizedRight) return 0;
			if (normalizedLeft === normalizedRight) return 1;
			const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
			if (maxLength === 0) return 1;
			return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength;
		};

		const chooseBestCandidate = (candidates: MatchCandidate[]): MatchCandidate => {
			const previousStart = this.startWordIndex ?? 0;
			let bestCandidate = candidates[0];
			let bestDistance = Math.abs(
				originalTokens[bestCandidate.tokenStart].sourceWordIndex - previousStart
			);

			for (let i = 1; i < candidates.length; i++) {
				const candidate = candidates[i];
				const candidateDistance = Math.abs(
					originalTokens[candidate.tokenStart].sourceWordIndex - previousStart
				);
				if (
					candidate.similarity > bestCandidate.similarity ||
					(candidate.similarity === bestCandidate.similarity && candidateDistance < bestDistance)
				) {
					bestCandidate = candidate;
					bestDistance = candidateDistance;
				}
			}

			return bestCandidate;
		};

		const originalTokens = toIndexedTokens(originalTranslationText);
		const currentTokens = toIndexedTokens(this.text);

		// Si le texte courant est vide/invalide après normalisation,
		// ou plus long que l'original, aucun alignement fiable n'est possible.
		if (
			currentTokens.length === 0 ||
			originalTokens.length === 0 ||
			currentTokens.length > originalTokens.length
		) {
			this.isBruteForce = true;
			return;
		}

		// Cas simple: contenu identique après normalisation.
		// On force isBruteForce à false pour éviter un état stale à true.
		const sameNormalizedContent =
			originalTokens.length === currentTokens.length &&
			originalTokens.every((token, i) => token.value === currentTokens[i].value);
		if (sameNormalizedContent) {
			this.startWordIndex = originalTokens[0].sourceWordIndex;
			this.endWordIndex = originalTokens[originalTokens.length - 1].sourceWordIndex;
			this.isBruteForce = false;
			return;
		}

		// Recherche d'une correspondance contiguë du texte courant dans le texte original.
		const candidates: MatchCandidate[] = [];
		for (let i = 0; i <= originalTokens.length - currentTokens.length; i++) {
			let ok = true;
			for (let j = 0; j < currentTokens.length; j++) {
				if (originalTokens[i + j].value !== currentTokens[j].value) {
					ok = false;
					break;
				}
			}
			if (ok) {
				candidates.push({
					tokenStart: i,
					tokenEnd: i + currentTokens.length - 1,
					similarity: 1
				});
			}
		}

		if (candidates.length === 0) {
			const currentTextForFuzzy = currentTokens.map((token) => token.value).join(' ');
			const fuzzyCandidates: MatchCandidate[] = [];
			const minWindowSize = Math.max(1, currentTokens.length - 2);
			const maxWindowSize = Math.min(originalTokens.length, currentTokens.length + 2);

			for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
				for (let tokenStart = 0; tokenStart <= originalTokens.length - windowSize; tokenStart++) {
					const tokenEnd = tokenStart + windowSize - 1;
					const candidateText = originalTokens
						.slice(tokenStart, tokenEnd + 1)
						.map((token) => token.value)
						.join(' ');
					const similarity = getSimilarity(currentTextForFuzzy, candidateText);
					if (similarity >= 0.95) {
						fuzzyCandidates.push({
							tokenStart,
							tokenEnd,
							similarity
						});
					}
				}
			}

			if (fuzzyCandidates.length === 0) {
				this.isBruteForce = true;
				return;
			}

			const bestFuzzyCandidate = chooseBestCandidate(fuzzyCandidates);
			this.startWordIndex = originalTokens[bestFuzzyCandidate.tokenStart].sourceWordIndex;
			this.endWordIndex = originalTokens[bestFuzzyCandidate.tokenEnd].sourceWordIndex;
			this.isBruteForce = false;
			return;
		}

		const bestCandidate = chooseBestCandidate(candidates);
		this.startWordIndex = originalTokens[bestCandidate.tokenStart].sourceWordIndex;
		this.endWordIndex = originalTokens[bestCandidate.tokenEnd].sourceWordIndex;
		this.isBruteForce = false;
	}
}

export class PredefinedSubtitleTranslation extends Translation {
	constructor(text: string) {
		super(text, 'completed by default');

		if (text === undefined) return; // déserialisation

		if (text.length > 0) {
			this.type = 'predefined';
		} else {
			this.type = 'other';
		}
	}
}
