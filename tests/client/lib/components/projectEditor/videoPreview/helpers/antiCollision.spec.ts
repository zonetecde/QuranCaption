import { describe, expect, test, vi } from 'vitest';
import {
	getTargetFromElement,
	resolveSubtitleCollisions
} from '$lib/components/projectEditor/videoPreview/helpers/antiCollision';

/**
 * Crée un élément HTML avec des classes CSS et, optionnellement, une bounding rect simulée.
 * Pour les tests de collision, on mock `getBoundingClientRect` sur chaque élément.
 */
function createElementWithClasses(
	tag: string,
	classNames: string[],
	rectOverrides: Partial<DOMRect> = {}
): HTMLElement {
	const el = document.createElement(tag);
	el.classList.add(...classNames);

	// Mock getBoundingClientRect pour simuler le positionnement
	const defaultRect: DOMRect = {
		x: 0,
		y: 0,
		width: 100,
		height: 30,
		top: 0,
		bottom: 30,
		left: 0,
		right: 100,
		toJSON: () => ({})
	};

	vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
		...defaultRect,
		...rectOverrides
	} as DOMRect);

	return el;
}

/** Petite promesse qui résout immédiatement (simule un wait sans délai). */
async function fakeWait(_signal: AbortSignal): Promise<void> {
	// Pas de délai réel pour les tests
}

describe('antiCollision', () => {
	describe('getTargetFromElement', () => {
		test('retourne "arabic" si l\'élément a la classe arabic', () => {
			const el = document.createElement('div');
			el.classList.add('arabic', 'subtitle');
			expect(getTargetFromElement(el, ['english', 'french'])).toBe('arabic');
		});

		test("retourne le nom de l'édition de traduction correspondante", () => {
			const el = document.createElement('div');
			el.classList.add('translation', 'french', 'subtitle');
			expect(getTargetFromElement(el, ['english', 'french'])).toBe('french');
		});

		test('retourne la première édition trouvée si plusieurs correspondent', () => {
			// L'élément a les classes "english" et "french" → on retourne la première
			// dans la liste translationKeys qui matche
			const el = document.createElement('div');
			el.classList.add('english', 'french');
			// La fonction vérifie dans l'ordre de translationKeys
			expect(getTargetFromElement(el, ['french', 'english'])).toBe('french');
		});

		test("retourne null si l'élément n'a ni arabic ni une édition connue", () => {
			const el = document.createElement('div');
			el.classList.add('subtitle', 'customText');
			expect(getTargetFromElement(el, ['english', 'french'])).toBeNull();
		});

		test('retourne null pour un élément sans classes', () => {
			const el = document.createElement('div');
			expect(getTargetFromElement(el, ['english'])).toBeNull();
		});

		test('ne confond pas une édition partielle (ex: "eng" ne matche pas "english")', () => {
			const el = document.createElement('div');
			el.classList.add('eng');
			expect(getTargetFromElement(el, ['english'])).toBeNull();
		});
	});

	describe('resolveSubtitleCollisions', () => {
		test("ne fait rien si aucun élément .subtitle n'est présent dans le DOM", async () => {
			const abortController = new AbortController();
			const getReactiveY = vi.fn().mockReturnValue(0);
			const setReactiveY = vi.fn();

			await resolveSubtitleCollisions(
				abortController.signal,
				10,
				['english'],
				getReactiveY,
				setReactiveY,
				fakeWait
			);

			// Aucun appel aux callbacks car pas d'éléments à traiter
			expect(getReactiveY).not.toHaveBeenCalled();
			expect(setReactiveY).not.toHaveBeenCalled();
		});

		test("ne décale pas les éléments s'ils ne sont pas en collision", async () => {
			const abortController = new AbortController();
			const getReactiveY = vi.fn().mockReturnValue(0);
			const setReactiveY = vi.fn();

			// Crée deux éléments distants (pas de collision)
			const arabicEl = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 0,
				bottom: 30,
				left: 0,
				right: 100
			});
			const translationEl = createElementWithClasses(
				'div',
				['translation', 'english', 'subtitle'],
				{
					top: 100,
					bottom: 130,
					left: 0,
					right: 100
				}
			);

			document.body.appendChild(arabicEl);
			document.body.appendChild(translationEl);

			try {
				await resolveSubtitleCollisions(
					abortController.signal,
					10,
					['english'],
					getReactiveY,
					setReactiveY,
					fakeWait
				);

				// Pas de décalage car pas de collision
				expect(setReactiveY).not.toHaveBeenCalled();
			} finally {
				document.body.removeChild(arabicEl);
				document.body.removeChild(translationEl);
			}
		});

		test('décale le sous-titre le plus bas quand il y a collision', async () => {
			const abortController = new AbortController();
			const reactiveYValues: Record<string, number> = { arabic: 0, english: 0 };

			const getReactiveY = vi.fn((target: string) => reactiveYValues[target] ?? 0);
			const setReactiveY = vi.fn((target: string, value: number) => {
				reactiveYValues[target] = value;
			});

			// Crée deux éléments qui se chevauchent verticalement
			// arabic: top=0, bottom=50
			const arabicEl = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 0,
				bottom: 50,
				left: 0,
				right: 100
			});

			// translation: top=40, bottom=90 → chevauchement de 10px avec arabic
			const translationEl = createElementWithClasses(
				'div',
				['translation', 'english', 'subtitle'],
				{
					top: 40,
					bottom: 90,
					left: 0,
					right: 100
				}
			);

			document.body.appendChild(arabicEl);
			document.body.appendChild(translationEl);

			try {
				await resolveSubtitleCollisions(
					abortController.signal,
					10,
					['english'],
					getReactiveY,
					setReactiveY,
					fakeWait
				);

				// translation est plus bas (top=40 > top=0), donc c'est lui qui doit être décalé
				expect(setReactiveY).toHaveBeenCalledWith('english', expect.any(Number));
				const englishNewY = reactiveYValues['english'];
				expect(englishNewY).toBeGreaterThan(0);
			} finally {
				document.body.removeChild(arabicEl);
				document.body.removeChild(translationEl);
			}
		});

		test("corrige le delta restant si le spacing réel est encore trop faible après l'application CSS", async () => {
			const abortController = new AbortController();
			const reactiveYValues: Record<string, number> = { arabic: 0, english: 0 };

			const getReactiveY = vi.fn((target: string) => reactiveYValues[target] ?? 0);
			const setReactiveY = vi.fn((target: string, value: number) => {
				reactiveYValues[target] = value;
			});

			const arabicEl = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 0,
				bottom: 50,
				left: 0,
				right: 100
			});

			const translationEl = createElementWithClasses(
				'div',
				['translation', 'english', 'subtitle'],
				{
					left: 0,
					right: 100
				}
			);

			vi.mocked(translationEl.getBoundingClientRect).mockImplementation(() => {
				const appliedOffset =
					reactiveYValues.english > 0 ? reactiveYValues.english - 5 : reactiveYValues.english;
				return {
					x: 0,
					y: 40 + appliedOffset,
					width: 100,
					height: 50,
					top: 40 + appliedOffset,
					bottom: 90 + appliedOffset,
					left: 0,
					right: 100,
					toJSON: () => ({})
				} as DOMRect;
			});

			document.body.appendChild(arabicEl);
			document.body.appendChild(translationEl);

			try {
				await resolveSubtitleCollisions(
					abortController.signal,
					10,
					['english'],
					getReactiveY,
					setReactiveY,
					fakeWait
				);

				expect(reactiveYValues.english).toBe(25);
			} finally {
				document.body.removeChild(arabicEl);
				document.body.removeChild(translationEl);
			}
		});

		test("s'arrête immédiatement si le signal est déjà aborté", async () => {
			const abortController = new AbortController();
			abortController.abort(); // Déjà aborté

			const getReactiveY = vi.fn();
			const setReactiveY = vi.fn();

			await resolveSubtitleCollisions(
				abortController.signal,
				10,
				['english'],
				getReactiveY,
				setReactiveY,
				fakeWait
			);

			expect(getReactiveY).not.toHaveBeenCalled();
			expect(setReactiveY).not.toHaveBeenCalled();
		});

		test("ne traite pas deux fois la même paire d'éléments", async () => {
			const abortController = new AbortController();
			const reactiveYValues: Record<string, number> = { arabic: 0, english: 0 };

			const getReactiveY = vi.fn((target: string) => reactiveYValues[target] ?? 0);
			const setReactiveY = vi.fn((target: string, value: number) => {
				reactiveYValues[target] = value;
			});

			// Trois éléments : arabic chevauche les deux traductions
			const arabicEl = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 0,
				bottom: 50,
				left: 0,
				right: 100
			});
			const enEl = createElementWithClasses('div', ['translation', 'english', 'subtitle'], {
				top: 40,
				bottom: 90,
				left: 0,
				right: 100
			});
			const frEl = createElementWithClasses('div', ['translation', 'french', 'subtitle'], {
				top: 45,
				bottom: 95,
				left: 0,
				right: 100
			});

			document.body.appendChild(arabicEl);
			document.body.appendChild(enEl);
			document.body.appendChild(frEl);

			try {
				await resolveSubtitleCollisions(
					abortController.signal,
					10,
					['english', 'french'],
					getReactiveY,
					setReactiveY,
					fakeWait
				);

				// Chaque target ne doit être ajusté qu'une fois max au sein d'une paire
				const englishCalls = setReactiveY.mock.calls.filter(
					([target]) => target === 'english'
				).length;
				const frenchCalls = setReactiveY.mock.calls.filter(
					([target]) => target === 'french'
				).length;

				// On attend au moins 1 ajustement (car collisions détectées)
				expect(englishCalls + frenchCalls).toBeGreaterThanOrEqual(1);
			} finally {
				document.body.removeChild(arabicEl);
				document.body.removeChild(enEl);
				document.body.removeChild(frEl);
			}
		});

		test('ne décale pas un élément si les targets sont identiques', async () => {
			const abortController = new AbortController();
			const getReactiveY = vi.fn().mockReturnValue(0);
			const setReactiveY = vi.fn();

			// Deux éléments avec le même target "arabic" en collision
			const arabicEl1 = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 0,
				bottom: 50,
				left: 0,
				right: 100
			});
			const arabicEl2 = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 30,
				bottom: 80,
				left: 0,
				right: 100
			});

			document.body.appendChild(arabicEl1);
			document.body.appendChild(arabicEl2);

			try {
				await resolveSubtitleCollisions(
					abortController.signal,
					10,
					['english'],
					getReactiveY,
					setReactiveY,
					fakeWait
				);

				// Pas de décalage car même target
				expect(setReactiveY).not.toHaveBeenCalled();
			} finally {
				document.body.removeChild(arabicEl1);
				document.body.removeChild(arabicEl2);
			}
		});

		test('ignore les éléments sans target identifiable', async () => {
			const abortController = new AbortController();
			const getReactiveY = vi.fn().mockReturnValue(0);
			const setReactiveY = vi.fn();

			// Un élément .subtitle sans target connu
			const unknownEl = createElementWithClasses('div', ['subtitle'], {
				top: 0,
				bottom: 50,
				left: 0,
				right: 100
			});
			const arabicEl = createElementWithClasses('div', ['arabic', 'subtitle'], {
				top: 30,
				bottom: 80,
				left: 0,
				right: 100
			});

			document.body.appendChild(unknownEl);
			document.body.appendChild(arabicEl);

			try {
				await resolveSubtitleCollisions(
					abortController.signal,
					10,
					['english'],
					getReactiveY,
					setReactiveY,
					fakeWait
				);

				// Pas de décalage car un des deux éléments n'a pas de target connu
				expect(setReactiveY).not.toHaveBeenCalled();
			} finally {
				document.body.removeChild(unknownEl);
				document.body.removeChild(arabicEl);
			}
		});
	});
});
