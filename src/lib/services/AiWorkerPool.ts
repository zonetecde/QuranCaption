/**
 * Exécute une liste avec une file dynamique partagée entre plusieurs workers.
 *
 * @param {readonly T[]} items Éléments à traiter.
 * @param {number} workerCount Nombre maximal de workers parallèles.
 * @param {(item: T, itemIndex: number, workerIndex: number) => Promise<void>} runItem Traitement d'un élément.
 * @param {() => boolean} shouldStop Condition optionnelle empêchant le démarrage de nouveaux éléments.
 * @returns {Promise<void>} Promesse résolue quand tous les workers sont arrêtés.
 */
export async function runAiWorkerPool<T>(
	items: readonly T[],
	workerCount: number,
	runItem: (item: T, itemIndex: number, workerIndex: number) => Promise<void>,
	shouldStop?: () => boolean
): Promise<void> {
	let nextItemIndex = 0;

	/**
	 * Consomme le prochain élément disponible jusqu'à épuisement de la file.
	 *
	 * @param {number} workerIndex Index stable du worker.
	 * @returns {Promise<void>} Promesse résolue quand le worker doit s'arrêter.
	 */
	const runWorker = async (workerIndex: number): Promise<void> => {
		while (!(shouldStop?.() ?? false)) {
			const itemIndex = nextItemIndex++;
			if (itemIndex >= items.length) return;
			await runItem(items[itemIndex], itemIndex, workerIndex);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(Math.max(workerCount, 0), items.length) }, (_, workerIndex) =>
			runWorker(workerIndex)
		)
	);
}

export type AiStreamChunkKind = 'reasoning' | 'response';
export type AiStreamChunkUpdate = {
	batchId: string;
	reasoning: string;
	response: string;
};

/** Regroupe brièvement les deltas streamés avant de rafraîchir l'interface. */
export class AiStreamChunkBuffer {
	private pending = new Map<string, { reasoning: string; response: string }>();
	private timeoutId: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Crée un buffer de deltas borné dans le temps.
	 *
	 * @param {(chunks: AiStreamChunkUpdate[]) => void} onFlush Traitement des deltas regroupés.
	 * @param {number} delayMs Délai maximal avant le rafraîchissement.
	 */
	constructor(
		private readonly onFlush: (chunks: AiStreamChunkUpdate[]) => void,
		private readonly delayMs: number = 50
	) {}

	/**
	 * Ajoute un delta au batch et au flux correspondants.
	 *
	 * @param {string} batchId Identifiant du batch.
	 * @param {AiStreamChunkKind} kind Type de flux.
	 * @param {string} delta Nouveau texte reçu.
	 * @returns {void}
	 */
	push(batchId: string, kind: AiStreamChunkKind, delta: string): void {
		const chunks = this.pending.get(batchId) ?? { reasoning: '', response: '' };
		chunks[kind] += delta;
		this.pending.set(batchId, chunks);
		this.timeoutId ??= setTimeout(() => this.flush(), this.delayMs);
	}

	/**
	 * Applique immédiatement les deltas en attente.
	 *
	 * @returns {void}
	 */
	flush(): void {
		if (this.timeoutId !== null) clearTimeout(this.timeoutId);
		this.timeoutId = null;
		if (this.pending.size === 0) return;

		const chunks = Array.from(this.pending, ([batchId, value]) => ({ batchId, ...value }));
		this.pending.clear();
		this.onFlush(chunks);
	}

	/**
	 * Abandonne les deltas et le rafraîchissement en attente.
	 *
	 * @returns {void}
	 */
	clear(): void {
		if (this.timeoutId !== null) clearTimeout(this.timeoutId);
		this.timeoutId = null;
		this.pending.clear();
	}
}

/**
 * Réunit le raisonnement et la réponse d'un worker dans un même texte.
 *
 * @param {Pick<AiStreamWorker, 'reasoning' | 'response'>} worker Flux du worker.
 * @param {string} reasoningLabel Libellé précédant le raisonnement.
 * @param {string} responseLabel Libellé précédant la réponse.
 * @returns {string} Texte complet affiché dans le textarea.
 */
export function formatAiWorkerOutput(
	worker: Pick<AiStreamWorker, 'reasoning' | 'response'>,
	reasoningLabel: string
): string {
	if (!worker.reasoning) return worker.response;
	return `${reasoningLabel}\n${worker.reasoning}\n${worker.response}`;
}

/**
 * Place un textarea sur la dernière ligne de son contenu streamé.
 *
 * @param {Pick<HTMLTextAreaElement, 'scrollTop' | 'scrollHeight'>} textarea Textarea à déplacer.
 * @returns {void}
 */
export function scrollTextareaToBottom(
	textarea: Pick<HTMLTextAreaElement, 'scrollTop' | 'scrollHeight'>
): void {
	textarea.scrollTop = textarea.scrollHeight;
}
export type AiStreamWorker = {
	workerId: number;
	batchId: string;
	batchLabel: string;
	step: string;
	reasoning: string;
	response: string;
	detail?: string;
};
