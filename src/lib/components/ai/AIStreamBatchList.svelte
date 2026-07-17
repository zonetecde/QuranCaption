<script module lang="ts">
	export type AIStreamBatchState = {
		batchId: string;
		index: number;
		total: number;
		status: 'pending' | 'running' | 'completed' | 'failed';
		reasoning: string;
		response: string;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';

	type StreamCopy = {
		streamedBatchLabel: (args: { current: number; total: number }) => string;
		currentStreamedResponse: () => string;
		currentStreamedReasoning: () => string;
	};

	let { batches, placeholder }: { batches: AIStreamBatchState[]; placeholder: string } = $props();
	const copy = get(LL).editor as unknown as StreamCopy;

	/**
	 * Maintient chaque sortie streamée positionnée sur son contenu le plus récent.
	 * @param {HTMLTextAreaElement} node Zone de texte concernée.
	 * @param {string} value Contenu streamé courant.
	 * @returns {{ update: (nextValue: string) => void }} Action mise à jour par Svelte.
	 */
	function scrollStreamToEnd(
		node: HTMLTextAreaElement,
		value: string
	): { update: (nextValue: string) => void } {
		/**
		 * Attend le rendu avant d'aligner le scroll sur la fin du flux.
		 * @param {string} nextValue Nouvelle valeur streamée.
		 * @returns {void}
		 */
		function update(nextValue: string): void {
			if (!nextValue) return;
			void tick().then(() => {
				node.scrollTop = node.scrollHeight;
			});
		}

		update(value);
		return { update };
	}
</script>

<div class="grid gap-3 md:grid-cols-2">
	{#each batches as batch (batch.batchId)}
		<div class="min-w-0 rounded-lg border border-color bg-accent p-3">
			<div class="mb-3 flex items-center justify-between gap-2">
				<span class="text-xs font-semibold text-primary">
					{copy.streamedBatchLabel({ current: batch.index, total: batch.total })}
				</span>
				<span
					class:animate-spin={batch.status === 'running'}
					class:text-accent-primary={batch.status === 'running'}
					class:text-green-400={batch.status === 'completed'}
					class:text-red-400={batch.status === 'failed'}
					class:text-thirdly={batch.status === 'pending'}
					class="material-icons text-base"
				>
					{batch.status === 'running'
						? 'sync'
						: batch.status === 'completed'
							? 'check_circle'
							: batch.status === 'failed'
								? 'error'
								: 'schedule'}
				</span>
			</div>

			{#if batch.reasoning}
				<div class="mb-3">
					<div
						class="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-thirdly"
					>
						<span class="material-icons text-xs">psychology</span>
						<span>{copy.currentStreamedReasoning()}</span>
					</div>
					<textarea
						readonly
						value={batch.reasoning}
						use:scrollStreamToEnd={batch.reasoning}
						class="h-24 w-full resize-none rounded-md border border-color bg-primary p-2 font-mono text-[11px] leading-relaxed text-primary"
					></textarea>
				</div>
			{/if}

			<div class="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-thirdly">
				<span class="material-icons text-xs">stream</span>
				<span>{copy.currentStreamedResponse()}</span>
			</div>
			<textarea
				readonly
				value={batch.response}
				use:scrollStreamToEnd={batch.response}
				class="h-28 w-full resize-none rounded-md border border-color bg-primary p-2 font-mono text-[11px] leading-relaxed text-primary"
				{placeholder}
			></textarea>
		</div>
	{/each}
</div>
