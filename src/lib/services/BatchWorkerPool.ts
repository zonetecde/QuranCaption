/**
 * Traite une liste avec un pool continu de workers à concurrence bornée.
 * @param {T[]} items Éléments à traiter dans leur ordre de prise en charge.
 * @param {number} concurrency Nombre maximal de traitements simultanés.
 * @param {(item: T) => Promise<void>} processItem Traitement propre à l'adapter Batch.
 * @returns {Promise<void>} Résolution après l'arrêt de tous les workers.
 */
export async function runBatchWorkerPool<T>(
	items: T[],
	concurrency: number,
	processItem: (item: T) => Promise<void>
): Promise<void> {
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (true) {
				const item = items[cursor++];
				if (item === undefined) return;
				await processItem(item);
			}
		})
	);
}
