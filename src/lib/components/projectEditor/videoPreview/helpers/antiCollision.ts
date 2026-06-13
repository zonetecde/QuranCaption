/**
 * Système d'anti-collision pour les sous-titres dans la prévisualisation vidéo.
 *
 * Principe : lorsqu'un sous-titre arabe chevauche un sous-titre de traduction
 * (ou vice-versa), le sous-titre le plus bas est décalé verticalement jusqu'à
 * ce qu'il n'y ait plus de collision. Une marge (`spacing`) est respectée
 * entre les éléments.
 *
 * Limitations :
 * - Validation DOM bornée après application pour garantir le spacing réel.
 * - Chaque paire (target1, target2) n'est traitée qu'une seule fois.
 */

const MAX_COLLISION_VALIDATION_PASSES = 3;

type SubtitleRectEntry = { target: string; rect: DOMRect };

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
	if (abortSignal.aborted) return;

	const subtitleRects = getSubtitleRectEntries(translationKeys);
	const offsets = getCollisionOffsets(subtitleRects, spacing, getReactiveY);

	const hasUpdates = applyCollisionOffsets(offsets, getReactiveY, setReactiveY);
	if (!hasUpdates) return;

	await wait(abortSignal);
	await validateCollisionSpacing(
		abortSignal,
		spacing,
		translationKeys,
		getReactiveY,
		setReactiveY,
		wait
	);
}

/**
 * Mesure les rectangles des sous-titres visibles.
 *
 * @param translationKeys - Clés des éditions de traduction pour la détection de target.
 * @returns Rectangles exploitables pour l'anti-collision.
 */
function getSubtitleRectEntries(translationKeys: string[]): SubtitleRectEntry[] {
	let allSubtitles = document.querySelectorAll('#subtitles-container .subtitle');
	if (allSubtitles.length === 0) {
		allSubtitles = document.querySelectorAll('.subtitle');
	}

	return (Array.from(allSubtitles) as HTMLElement[])
		.map((element) => {
			const target = getTargetFromElement(element, translationKeys);
			if (!target) return null;
			return {
				target,
				rect: element.getBoundingClientRect()
			};
		})
		.filter(
			(entry): entry is SubtitleRectEntry =>
				entry !== null && entry.rect.width > 0 && entry.rect.height > 0
		);
}

/**
 * Calcule les offsets nécessaires pour respecter le spacing demandé.
 *
 * @param subtitleRects - Rectangles de sous-titres mesurés.
 * @param spacing - Espacement minimal entre sous-titres.
 * @param getInitialOffset - Offset initial à appliquer virtuellement par target.
 * @returns Offsets calculés par target.
 */
function getCollisionOffsets(
	subtitleRects: SubtitleRectEntry[],
	spacing: number,
	getInitialOffset: (target: string) => number
): Map<string, number> {
	const offsets = new Map<string, number>();
	for (const entry of subtitleRects) {
		if (!offsets.has(entry.target)) offsets.set(entry.target, getInitialOffset(entry.target));
	}

	// Set pour éviter de traiter deux fois la même paire (targetA, targetB)
	const processedPairs = new Set<string>();

	for (let i = 0; i < subtitleRects.length; i++) {
		const currentEntry = subtitleRects[i];

		// On ne compare qu'avec les éléments suivants (j > i) pour éviter les doublons
		for (let j = i + 1; j < subtitleRects.length; j++) {
			const otherEntry = subtitleRects[j];

			// Vérification : targets différents, pas déjà traités
			if (currentEntry.target === otherEntry.target) continue;

			const pairId = [currentEntry.target, otherEntry.target].sort().join('-');
			if (processedPairs.has(pairId)) continue;

			// Détection de collision via les rectangles englobants
			const currentRect = getAdjustedRect(currentEntry.rect, offsets.get(currentEntry.target) ?? 0);
			const otherRect = getAdjustedRect(otherEntry.rect, offsets.get(otherEntry.target) ?? 0);
			const isColliding = areRectsColliding(currentRect, otherRect, spacing);

			if (!isColliding) continue;

			// Marque la paire comme traitée
			processedPairs.add(pairId);

			// On décale l'élément le plus bas
			const targetToAdjust =
				currentRect.top > otherRect.top ? currentEntry.target : otherEntry.target;
			const upperRect = targetToAdjust === currentEntry.target ? otherRect : currentRect;
			const lowerRect = targetToAdjust === currentEntry.target ? currentRect : otherRect;
			const adjustmentNeeded = Math.max(0, upperRect.bottom + spacing - lowerRect.top);

			if (adjustmentNeeded > 0) {
				offsets.set(targetToAdjust, (offsets.get(targetToAdjust) ?? 0) + adjustmentNeeded);
			}
		}
	}

	return offsets;
}

/**
 * Applique les offsets calculés aux targets qui changent réellement.
 *
 * @param offsets - Offsets calculés par target.
 * @param getReactiveY - Récupère la position Y réactive actuelle d'un target.
 * @param setReactiveY - Définit la nouvelle position Y réactive d'un target.
 * @returns `true` si au moins un target a été mis à jour.
 */
function applyCollisionOffsets(
	offsets: Map<string, number>,
	getReactiveY: (target: string) => number,
	setReactiveY: (target: string, value: number) => void
): boolean {
	let hasUpdates = false;
	for (const [target, value] of offsets) {
		if (value === getReactiveY(target)) continue;
		setReactiveY(target, value);
		hasUpdates = true;
	}

	return hasUpdates;
}

/**
 * Vérifie le spacing réel après application CSS et corrige le delta restant.
 *
 * @param abortSignal - Signal pour annuler l'opération en cours.
 * @param spacing - Espacement minimal entre sous-titres.
 * @param translationKeys - Clés des éditions de traduction pour la détection de target.
 * @param getReactiveY - Récupère la position Y réactive actuelle d'un target.
 * @param setReactiveY - Définit la nouvelle position Y réactive d'un target.
 * @param wait - Fonction d'attente asynchrone.
 * @returns Promise résolue à la fin de la validation.
 */
async function validateCollisionSpacing(
	abortSignal: AbortSignal,
	spacing: number,
	translationKeys: string[],
	getReactiveY: (target: string) => number,
	setReactiveY: (target: string, value: number) => void,
	wait: (signal: AbortSignal) => Promise<void>
): Promise<void> {
	for (let pass = 0; pass < MAX_COLLISION_VALIDATION_PASSES; pass++) {
		if (abortSignal.aborted) return;

		const subtitleRects = getSubtitleRectEntries(translationKeys);
		const additionalOffsets = getCollisionOffsets(subtitleRects, spacing, () => 0);
		let hasUpdates = false;

		for (const [target, offset] of additionalOffsets) {
			if (offset <= 0) continue;
			setReactiveY(target, getReactiveY(target) + offset);
			hasUpdates = true;
		}

		if (!hasUpdates) return;
		await wait(abortSignal);
	}
}

/**
 * Décale virtuellement un rectangle sans relire le layout DOM.
 *
 * @param rect - Rectangle mesuré initialement.
 * @param offsetY - Décalage vertical appliqué en mémoire.
 * @returns Rectangle minimal utilisé pour les calculs de collision.
 */
function getAdjustedRect(
	rect: DOMRect,
	offsetY: number
): Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'> {
	return {
		top: rect.top + offsetY,
		right: rect.right,
		bottom: rect.bottom + offsetY,
		left: rect.left
	};
}

/**
 * Détecte une collision entre deux rectangles avec une marge minimale.
 *
 * @param firstRect - Premier rectangle.
 * @param secondRect - Second rectangle.
 * @param spacing - Espacement minimal souhaité.
 * @returns `true` si les rectangles se chevauchent ou sont trop proches.
 */
function areRectsColliding(
	firstRect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
	secondRect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
	spacing: number
): boolean {
	return !(
		firstRect.bottom + spacing < secondRect.top ||
		firstRect.top - spacing > secondRect.bottom ||
		firstRect.right + spacing < secondRect.left ||
		firstRect.left - spacing > secondRect.right
	);
}
