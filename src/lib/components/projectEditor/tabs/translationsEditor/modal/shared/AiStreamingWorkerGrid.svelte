<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import {
		formatAiWorkerOutput,
		scrollTextareaToBottom,
		type AiStreamWorker
	} from '$lib/services/AiWorkerPool';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	let {
		workers,
		columnsClass = 'grid-cols-3',
		textareaClass = 'h-48'
	}: {
		workers: AiStreamWorker[];
		columnsClass?: string;
		textareaClass?: string;
	} = $props();
	let textareaElements: HTMLTextAreaElement[] = $state([]);

	/**
	 * Formate les flux du worker avec les libellés de l'interface courante.
	 *
	 * @param {AiStreamWorker} worker Worker à afficher.
	 * @returns {string} Raisonnement et réponse réunis.
	 */
	function getWorkerOutput(worker: AiStreamWorker): string {
		return formatAiWorkerOutput(worker, get(LL).aiVideo.reasoningEffort());
	}

	/**
	 * Place chaque textarea sur la dernière ligne reçue.
	 *
	 * @returns {void}
	 */
	function scrollOutputsToBottom(): void {
		for (const textarea of textareaElements) {
			if (textarea) scrollTextareaToBottom(textarea);
		}
	}

	$effect(() => {
		const outputSnapshot = workers.map(getWorkerOutput).join('\0');
		void tick().then(() => {
			void outputSnapshot;
			scrollOutputsToBottom();
		});
	});
</script>

<div class="grid gap-3 {columnsClass}">
	{#each workers as worker, index (worker.workerId)}
		<div class="min-w-0 rounded-xl border border-color bg-secondary p-3">
			<div class="mb-2 flex items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-primary">
					<span class="material-icons text-sm text-accent-primary">dns</span>
					<span>#{worker.workerId}</span>
				</div>
				<span class="truncate text-[11px] uppercase tracking-wide text-thirdly">
					{worker.step === 'idle' ? $LL.settings.idle() : worker.step}
				</span>
			</div>
			<div class="mb-2 truncate text-xs text-secondary">
				{worker.batchLabel || $LL.settings.idle()}
			</div>
			{#if worker.detail}
				<div class="mb-2 truncate text-[11px] text-thirdly">{worker.detail}</div>
			{/if}
			<textarea
				readonly
				bind:this={textareaElements[index]}
				value={getWorkerOutput(worker)}
				class="{textareaClass} w-full resize-none rounded-lg border border-color bg-accent p-2 font-mono text-[11px] leading-relaxed text-secondary"
				placeholder={$LL.translations.streamingResponsePlaceholder()}
			></textarea>
			<button
				class="btn mt-2 w-full px-2 py-1.5 text-xs"
				onclick={() => {
					navigator.clipboard.writeText(getWorkerOutput(worker));
					toast.success($LL.translations.liveResponseCopied());
				}}
				disabled={!getWorkerOutput(worker)}
			>
				{$LL.common.copy()}
			</button>
		</div>
	{/each}
</div>
