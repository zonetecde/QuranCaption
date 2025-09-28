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

		if (originalTranslationText) {
			if (!originalTranslationText.includes(this.text)) {
				return; // La traduction a été bruteforcée, on ne fait rien
			}

			const originalWords = originalTranslationText.split(' ');
			const currentWords = this.text.split(' ');

			// Si le texte de la traduction n'a pas changé, on ne fait rien
			if (originalWords.length === currentWords.length) {
				return;
			}

			// Trouve maintenant l'index du premier mot de la traduction dans le texte original de telle sorte que tous les mots de la traduction soient présents dans le texte original
			let startIndex = -1;
			for (let i = 0; i < originalWords.length; i++) {
				if (originalWords[i] === currentWords[0]) {
					// Potentiel début trouvé, vérifie que tous les mots suivants sont présents
					let allMatch = true;
					for (let j = 1; j < currentWords.length; j++) {
						if (originalWords[i + j] !== currentWords[j]) {
							allMatch = false;
							break;
						}
					}
					if (allMatch) {
						startIndex = i;
						break;
					}
				}
			}
			if (startIndex !== -1) {
				this.startWordIndex = startIndex;
				this.endWordIndex = startIndex + currentWords.length - 1;
				this.isBruteForce = false;
			} else {
				// La traduction a été bruteforcée, on ne fait rien
				this.isBruteForce = true;
			}
		}
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
