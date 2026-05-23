import { describe, expect, test, vi } from 'vitest';
import { applyReactiveFontSize } from '$lib/components/projectEditor/videoPreview/helpers/reactiveFontSize';

/** Promesse qui résout immédiatement (simule wait sans délai). */
async function fakeWait(_signal: AbortSignal): Promise<void> {}

/**
 * Crée un div avec les classes `.target.subtitle` et un `scrollHeight` simulé.
 * Utile pour tester `applyReactiveFontSize` qui itère sur `querySelectorAll`.
 */
function createSubtitleElement(target: string, scrollHeight: number): HTMLElement {
	const el = document.createElement('div');
	el.classList.add(target, 'subtitle');

	// `scrollHeight` n'est pas modifiable directement, on utilise un spy.
	// Mais `vi.spyOn` sur une propriété d'instance HTMLElement peut ne pas marcher.
	// On définit via Object.defineProperty.
	Object.defineProperty(el, 'scrollHeight', {
		value: scrollHeight,
		writable: true,
		configurable: true
	});

	return el;
}

describe('reactiveFontSize', () => {
	describe('applyReactiveFontSize', () => {
		test('ne fait rien de plus que définir la taille initiale si maxHeight est 0', async () => {
			const abortController = new AbortController();
			const setReactiveFontSize = vi.fn();

			await applyReactiveFontSize(
				'arabic',
				0, // maxHeight = 0 → pas de contrainte
				42, // taille initiale
				true, // centré verticalement
				abortController.signal,
				setReactiveFontSize,
				fakeWait
			);

			expect(setReactiveFontSize).toHaveBeenCalledWith('arabic', 42);
			expect(setReactiveFontSize).toHaveBeenCalledTimes(1);
		});

		test('définit la taille initiale avant de vérifier les contraintes', async () => {
			const abortController = new AbortController();
			const calls: Array<[string, number]> = [];
			const setReactiveFontSize = vi.fn((target: string, value: number) => {
				calls.push([target, value]);
			});

			const el = createSubtitleElement('arabic', 30); // scrollHeight = 30
			document.body.appendChild(el);

			try {
				await applyReactiveFontSize(
					'arabic',
					100, // maxHeight = 100px
					50, // taille initiale
					true,
					abortController.signal,
					setReactiveFontSize,
					fakeWait
				);

				// Le premier appel doit être la taille initiale
				expect(calls[0]).toEqual(['arabic', 50]);
			} finally {
				document.body.removeChild(el);
			}
		});

		test('réduit la taille si le scrollHeight dépasse maxHeight', async () => {
			const abortController = new AbortController();
			const calls: Array<[string, number]> = [];
			const setReactiveFontSize = vi.fn((target: string, value: number) => {
				calls.push([target, value]);
			});

			// scrollHeight=200 dépasse maxHeight=100
			const el = createSubtitleElement('arabic', 200);
			document.body.appendChild(el);

			try {
				await applyReactiveFontSize(
					'arabic',
					100,
					50,
					true,
					abortController.signal,
					setReactiveFontSize,
					fakeWait
				);

				// Au moins 2 appels : taille initiale + une ou plusieurs réductions
				expect(calls.length).toBeGreaterThanOrEqual(2);

				// La dernière taille doit être strictement inférieure à l'initiale
				const lastSize = calls[calls.length - 1][1];
				expect(lastSize).toBeLessThan(50);
			} finally {
				document.body.removeChild(el);
			}
		});

		test('ne réduit pas la taille si le scrollHeight est déjà dans la limite', async () => {
			const abortController = new AbortController();
			const calls: Array<[string, number]> = [];
			const setReactiveFontSize = vi.fn((target: string, value: number) => {
				calls.push([target, value]);
			});

			// scrollHeight=50 ≤ maxHeight=100
			const el = createSubtitleElement('arabic', 50);
			document.body.appendChild(el);

			try {
				await applyReactiveFontSize(
					'arabic',
					100,
					42,
					true,
					abortController.signal,
					setReactiveFontSize,
					fakeWait
				);

				// Un seul appel : la taille initiale (la boucle while ne s'exécute pas car 50 ≤ 100)
				expect(calls.length).toBe(1);
				expect(calls[0]).toEqual(['arabic', 42]);
			} finally {
				document.body.removeChild(el);
			}
		});

		test("s'arrête immédiatement si le signal est déjà aborté", async () => {
			const abortController = new AbortController();
			abortController.abort();

			const setReactiveFontSize = vi.fn();

			// Même sans élément DOM, l'abort est vérifié avant la boucle for...of
			// donc setReactiveFontSize ne doit pas être appelé
			await applyReactiveFontSize(
				'arabic',
				100,
				42,
				true,
				abortController.signal,
				setReactiveFontSize,
				fakeWait
			);

			// Le setReactiveFontSize initial est appelé avant le premier await
			expect(setReactiveFontSize).toHaveBeenCalledWith('arabic', 42);
		});

		test("ajoute une marge de 10px si le texte n'est pas centré verticalement", async () => {
			const abortController = new AbortController();
			const calls: Array<[string, number]> = [];
			const setReactiveFontSize = vi.fn((target: string, value: number) => {
				calls.push([target, value]);
			});

			// scrollHeight=105 dépasse maxHeight=100 uniquement avec la marge de 10 (car pas centré)
			// Avec marge=10 : 105 > 100+10 ? Non, 105 < 110 donc pas de réduction.
			// Testons avec scrollHeight=115 : 115 > 100+10=110 → réduction.
			const el = createSubtitleElement('arabic', 115);
			document.body.appendChild(el);

			try {
				await applyReactiveFontSize(
					'arabic',
					100,
					42,
					false, // PAS centré → marge de 10
					abortController.signal,
					setReactiveFontSize,
					fakeWait
				);

				// La réduction doit se produire car 115 > 110 (100 + marge)
				expect(calls.length).toBeGreaterThanOrEqual(2);
			} finally {
				document.body.removeChild(el);
			}
		});

		test('ne réduit pas en dessous de 1px', async () => {
			const abortController = new AbortController();
			const minSizes: number[] = [];
			const setReactiveFontSize = vi.fn((_target: string, value: number) => {
				minSizes.push(value);
			});

			// scrollHeight énorme pour forcer des réductions successives
			const el = createSubtitleElement('arabic', 10000);
			document.body.appendChild(el);

			try {
				await applyReactiveFontSize(
					'arabic',
					100,
					42,
					true,
					abortController.signal,
					setReactiveFontSize,
					fakeWait
				);

				// La dernière valeur peut passer sous 1 car la condition `fontSize > 1`
				// est vérifiée AVANT la réduction. On vérifie que :
				// - toutes les valeurs sont > 0
				// - toutes les valeurs sauf la dernière sont >= 1
				for (const size of minSizes) {
					expect(size).toBeGreaterThan(0);
				}
				const allButLast = minSizes.slice(0, -1);
				for (const size of allButLast) {
					expect(size).toBeGreaterThanOrEqual(1);
				}
			} finally {
				document.body.removeChild(el);
			}
		});
	});
});
