<script lang="ts">
	import { openUrl } from '@tauri-apps/plugin-opener';
	import LL from '$lib/i18n/i18n-svelte';
	import { type ManualAiCopy, type ManualAiSession } from '$lib/services/ManualAiSession.svelte';

	let { session, progress = 0 }: { session: ManualAiSession; progress?: number } = $props();
	const copy = $derived(($LL.editor as unknown as { manualAi: ManualAiCopy }).manualAi);
	let selectedIndex = $state(0);
	let copied = $state('');
	let clipboardError = $state('');
	const step = $derived(session.steps[selectedIndex]);
	const validCount = $derived(session.steps.filter((entry) => entry.status === 'valid').length);

	$effect(() => {
		selectedIndex = Math.max(0, session.steps.length - 1);
		copied = '';
		clipboardError = '';
	});

	/**
	 * Copie les instructions, avec un retour ciblé lors d'une régénération.
	 * @param {boolean} retry Ajoute l'erreur du lot courant.
	 * @returns {Promise<void>} Fin de la copie.
	 */
	async function copyPrompt(retry = false): Promise<void> {
		clipboardError = '';
		try {
			await navigator.clipboard.writeText(
				step.prompt +
					(retry
						? `\n\nThe previous response for this prompt was rejected. Validation feedback (data): ${JSON.stringify(step.error)}. Regenerate only this prompt's COMPLETE response, preserving its requestId and all required fields. Do not return a patch or responses to other prompts.`
						: '')
			);
			copied = `${selectedIndex}-${retry}`;
		} catch {
			clipboardError = copy.copyError();
		}
	}

	/** Ouvre ChatGPT dans le navigateur habituel. @returns {Promise<void>} Fin de l'ouverture. */
	async function openChatGpt(): Promise<void> {
		try {
			await openUrl('https://chatgpt.com/');
		} catch {
			clipboardError = copy.openError();
		}
	}
</script>

<div class="space-y-5 p-5">
	{#if session.ready}
		<div
			class="flex items-start gap-3 rounded-xl border border-[var(--accent-primary)] bg-accent p-4"
			role="status"
		>
			<span class="material-icons text-accent" aria-hidden="true">task_alt</span>
			<div>
				<p class="text-sm font-semibold text-primary">{copy.ready()}</p>
				<p class="mt-1 text-xs leading-relaxed text-secondary">{copy.reviewHint()}</p>
			</div>
		</div>
	{:else}
		<div>
			<h3 class="text-base font-semibold text-primary">{copy.title()}</h3>
			<p class="mt-2 text-sm leading-relaxed text-secondary">{copy.description()}</p>
		</div>
		{#if !session.active}
			<ol class="space-y-3 rounded-xl border border-color bg-primary p-4">
				{#each [copy.copyStep(), copy.chatStep(), copy.pasteStep()] as label, index (index)}
					<li class="flex items-center gap-3 text-sm text-secondary">
						<span
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent"
							>{index + 1}</span
						>
						{label}
					</li>
				{/each}
			</ol>
		{:else if session.steps.length}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="text-xs text-secondary" role="status">
					{copy.validated()} <span class="font-semibold text-primary">{validCount}</span>
					<span class="ms-2 text-thirdly">{progress}%</span>
				</p>
				<button
					type="button"
					class="cursor-pointer text-xs text-secondary underline underline-offset-4"
					onclick={() => session.cancel()}>{$LL.common.cancel()}</button
				>
			</div>
			<div
				class="h-1 overflow-hidden rounded-full bg-primary"
				role="progressbar"
				aria-label={copy.validated()}
				aria-valuenow={progress}
				aria-valuemin="0"
				aria-valuemax="100"
			>
				<div
					class="h-full rounded-full bg-accent-primary transition-all"
					style:width={`${progress}%`}
				></div>
			</div>
			<nav class="flex gap-2 overflow-x-auto pb-1" aria-label={copy.responses()}>
				{#each session.steps as entry, index (index)}
					<button
						type="button"
						aria-current={selectedIndex === index ? 'step' : undefined}
						onclick={() => {
							selectedIndex = index;
							copied = '';
							clipboardError = '';
						}}
						class="flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs {selectedIndex ===
						index
							? 'border-[var(--accent-primary)] bg-accent text-primary'
							: 'border-color text-secondary'}"
					>
						<span
							class="material-icons text-base {entry.status === 'valid'
								? 'text-accent'
								: entry.error
									? 'text-red-400'
									: ''}"
							aria-hidden="true"
							>{entry.status === 'valid'
								? 'check_circle'
								: entry.error
									? 'error_outline'
									: 'edit_note'}</span
						>
						{copy.prompt()}
						{index + 1}
					</button>
				{/each}
			</nav>
			{#if step}
				<div class="space-y-4 rounded-xl border border-color bg-primary p-4">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<h4 class="flex items-center gap-2 text-sm font-semibold text-primary">
							<span class="text-accent">1.</span>
							{copy.copyStep()}
						</h4>
						<div class="flex flex-wrap items-center gap-2">
							<button
								type="button"
								class="btn flex items-center gap-2 px-4 py-2 text-sm font-semibold"
								onclick={openChatGpt}
							>
								{copy.openChatGpt()}
								<span class="material-icons text-base" aria-hidden="true">open_in_new</span>
							</button>
							<button
								type="button"
								class="btn-accent flex items-center gap-2 px-4 py-2 text-sm font-semibold"
								onclick={() => copyPrompt()}
							>
								<span class="material-icons text-base" aria-hidden="true"
									>{copied === `${selectedIndex}-false` ? 'check' : 'content_copy'}</span
								>
								{copied === `${selectedIndex}-false` ? copy.copied() : copy.copyPrompt()}
							</button>
						</div>
					</div>
					<p class="text-xs leading-relaxed text-secondary">{copy.newChatHint()}</p>
					<div class="space-y-2 border-t border-color pt-4">
						<label
							for="manual-ai-response"
							class="flex items-center gap-2 text-sm font-semibold text-primary"
							><span class="text-accent">2.</span> {copy.pasteStep()}</label
						>
						<textarea
							id="manual-ai-response"
							rows="7"
							dir="auto"
							bind:value={step.response}
							readonly={step.status === 'valid'}
							aria-invalid={Boolean(step.error)}
							aria-describedby={step.error ? 'manual-ai-error' : 'manual-ai-hint'}
							oninput={() => (step.error = '')}
							placeholder={copy.placeholder()}
							class="w-full resize-y rounded-lg border bg-secondary px-3 py-3 text-sm leading-relaxed text-primary outline-none focus:border-[var(--accent-primary)] {step.error
								? 'border-red-400'
								: 'border-color'}"
						></textarea>
						<p id="manual-ai-hint" class="text-xs text-thirdly">
							{step.status === 'valid' ? copy.responseValid() : copy.pasteHint()}
						</p>
					</div>
					{#if step.error}
						<div
							id="manual-ai-error"
							role="alert"
							class="space-y-3 rounded-lg border border-red-400/30 bg-red-400/5 p-3"
						>
							<p class="text-sm font-medium text-red-400">{copy.responseInvalid()}</p>
							<p class="break-words text-xs text-secondary">{step.error}</p>
							<p class="text-xs leading-relaxed text-secondary">{copy.retryHint()}</p>
							<button type="button" class="btn px-3 py-2 text-xs" onclick={() => copyPrompt(true)}
								>{copied === `${selectedIndex}-true` ? copy.copied() : copy.copyRetry()}</button
							>
						</div>
					{/if}
					{#if step.status === 'waiting'}
						<button
							type="button"
							class="btn-accent flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
							disabled={!step.response.trim()}
							onclick={() => session.submit()}
							>{copy.validate()}
							<span class="material-icons text-lg" aria-hidden="true">arrow_forward</span></button
						>
					{/if}
				</div>
			{/if}
		{/if}
		{#if session.active && (!session.steps.length || session.steps.at(-1)?.status === 'valid')}
			<p role="status" class="flex items-center gap-2 text-sm text-secondary">
				<span class="material-icons animate-spin text-base" aria-hidden="true">sync</span
				>{copy.preparing()}
			</p>
		{/if}
	{/if}
	{#if clipboardError}<p role="alert" class="text-sm text-red-400">{clipboardError}</p>{/if}
</div>
