/**
 * Système d'anti-collision pour les sous-titres dans la prévisualisation vidéo.
 *
 * Principe : lorsqu'un sous-titre arabe chevauche un sous-titre de traduction
 * (ou vice-versa), le sous-titre le plus bas est décalé verticalement jusqu'à
 * ce qu'il n'y ait plus de collision. Une marge (`spacing`) est respectée
 * entre les éléments.
 *
 * Limitations :
 * - Maximum 10 itérations de décalage par paire pour éviter les boucles infinies.
 * - Chaque paire (target1, target2) n'est traitée qu'une seule fois.
 */

/**
 * Détecte le target de style (arabic, nom d'édition de traduction...)
 * à partir des classes CSS d'un élément de sous-titre.
 *
 * @param element - L'élément HTML du sous-titre.
 * @param translationKeys - Liste des clés d'édition de traduction connues.
 * @returns Le nom du target ou `null` si non identifié.
 */
export function getTargetFromElement(
	element: HTMLElement,
	translationKeys: string[]
): string | null {
	const classList = Array.from(element.classList);

	// L'élément arabe porte la classe "arabic"
	if (classList.includes('arabic')) {
		return 'arabic';
	}

	// Cherche si l'élément correspond à une édition de traduction
	for (const translationKey of translationKeys) {
		if (classList.includes(translationKey)) {
			return translationKey;
		}
	}

	return null;
}

/**
 * Résout les collisions entre sous-titres visibles.
 *
 * Parcourt toutes les paires d'éléments `.subtitle`, détecte les
 * chevauchements, et décale l'élément le plus bas vers le bas jusqu'à
 * résolution (ou atteinte de la limite d'itérations).
 *
 * @param abortSignal - Signal pour annuler l'opération en cours.
 * @param spacing - Espacement minimal entre sous-titres (en px).
 * @param translationKeys - Clés des éditions de traduction pour la détection de target.
 * @param getReactiveY - Récupère la position Y réactive actuelle d'un target.
 * @param setReactiveY - Définit la nouvelle position Y réactive d'un target.
 * @param wait - Fonction d'attente asynchrone (cède au navigateur entre deux ajustements).
 */
export async function resolveSubtitleCollisions(
	abortSignal: AbortSignal,
	spacing: number,
	translationKeys: string[],
	getReactiveY: (target: string) => number,
	setReactiveY: (target: string, value: number) => void,
	wait: (signal: AbortSignal) => Promise<void>
): Promise<void> {
	const allSubtitles = document.querySelectorAll('#subtitles-container .subtitle');
	const subtitleElements = Array.from(allSubtitles) as HTMLElement[];

	// Set pour éviter de traiter deux fois la même paire (targetA, targetB)
	const processedPairs = new Set<string>();

	for (let i = 0; i < subtitleElements.length; i++) {
		if (abortSignal.aborted) return;

		const currentElement = subtitleElements[i];
		const currentTarget = getTargetFromElement(currentElement, translationKeys);

		if (!currentTarget) continue;

		const currentRect = currentElement.getBoundingClientRect();

		// On ne compare qu'avec les éléments suivants (j > i) pour éviter les doublons
		for (let j = i + 1; j < subtitleElements.length; j++) {
			const otherElement = subtitleElements[j];
			const otherTarget = getTargetFromElement(otherElement, translationKeys);

			// Vérification : targets différents, pas déjà traités
			if (!otherTarget || currentTarget === otherTarget) continue;

			const pairId = [currentTarget, otherTarget].sort().join('-');
			if (processedPairs.has(pairId)) continue;

			// Détection de collision via les rectangles englobants
			const otherRect = otherElement.getBoundingClientRect();
			const isColliding = !(
				currentRect.bottom < otherRect.top ||
				currentRect.top > otherRect.bottom ||
				currentRect.right < otherRect.left ||
				currentRect.left > otherRect.right
			);

			if (!isColliding) continue;

			// Marque la paire comme traitée
			processedPairs.add(pairId);

			// On décale l'élément le plus bas
			const targetToAdjust = currentRect.top > otherRect.top ? currentTarget : otherTarget;

			let stillColliding: boolean;
			let iterationCount = 0;
			const maxIterations = 10; // Sécurité anti-boucle infinie

			do {
				iterationCount++;

				if (abortSignal.aborted) return;

				// Recalcule les positions après chaque ajustement
				const currentRectLoop = currentElement.getBoundingClientRect();
				const otherRectLoop = otherElement.getBoundingClientRect();

				// Calcule le chevauchement vertical
				const overlapHeight = Math.abs(currentRectLoop.bottom - otherRectLoop.top);
				const adjustmentNeeded = overlapHeight + spacing;

				const currentValue = getReactiveY(targetToAdjust);
				const newValue = currentValue + adjustmentNeeded;

				setReactiveY(targetToAdjust, newValue);

				// Laisse le DOM se mettre à jour
				await wait(abortSignal);

				// Vérifie si la collision persiste
				const newCurrentRect = currentElement.getBoundingClientRect();
				const newOtherRect = otherElement.getBoundingClientRect();

				stillColliding = !(
					newCurrentRect.bottom + spacing < newOtherRect.top ||
					newCurrentRect.top - spacing > newOtherRect.bottom ||
					newCurrentRect.right + spacing < newOtherRect.left ||
					newCurrentRect.left - spacing > newOtherRect.right
				);
			} while (stillColliding && iterationCount < maxIterations);
		}
	}
}
