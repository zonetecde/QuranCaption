<script lang="ts">
	type SpeakerRemovalChoice =
		| { action: 'cancel' }
		| { action: 'unassigned' }
		| { action: 'reassign'; replacement: string };

	let {
		speakerName,
		usageCount,
		replacementOptions,
		isProjectSpeaker,
		resolve
	}: {
		speakerName: string;
		usageCount: number;
		replacementOptions: string[];
		isProjectSpeaker: boolean;
		resolve: (choice: SpeakerRemovalChoice) => void;
	} = $props();

	let replacement = $state(replacementOptions[0] ?? '');
	let resolved = false;

	function finish(choice: SpeakerRemovalChoice): void {
		if (resolved) return;
		resolved = true;
		resolve(choice);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			finish({ action: 'cancel' });
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="relative flex w-[560px] max-w-[92vw] flex-col rounded-2xl border border-color bg-secondary p-6 shadow-2xl shadow-black/60"
>
	<div class="flex items-start gap-3">
		<div
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300"
		>
			<span class="material-icons text-xl">person_remove</span>
		</div>
		<div class="min-w-0 flex-1">
			<h2 class="text-lg font-semibold text-primary">Remove speaker</h2>
			<p class="mt-1 text-sm leading-relaxed text-secondary">
				<strong class="text-primary">{speakerName}</strong> is assigned to {usageCount}
				transcript segment{usageCount === 1 ? '' : 's'}.
			</p>
		</div>
		<button
			type="button"
			class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-secondary transition hover:bg-accent hover:text-primary"
			onclick={() => finish({ action: 'cancel' })}
			aria-label="Cancel"
		>
			<span class="material-icons text-lg">close</span>
		</button>
	</div>

	<div class="my-5 h-px bg-border-color"></div>

	<div class="space-y-4">
		<p class="text-sm leading-relaxed text-secondary">
			Choose what should happen to those segments before removing the speaker from the project.
		</p>

		{#if isProjectSpeaker}
			<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs leading-relaxed text-yellow-200"
			>
				This is also the project's main speaker. That project field will be replaced or cleared.
			</div>
		{/if}

		<div class="rounded-xl border border-color bg-primary p-4">
			<label class="block space-y-2">
				<span class="text-sm font-semibold text-primary">Reassign the segments</span>
				<select
					class="w-full rounded-lg border border-color bg-secondary px-3 py-2.5 text-primary outline-none focus:border-[var(--accent-primary)] disabled:opacity-50"
					bind:value={replacement}
					disabled={replacementOptions.length === 0}
				>
					{#if replacementOptions.length === 0}
						<option value="">No other speaker available</option>
					{:else}
						{#each replacementOptions as option (option)}
							<option value={option}>{option}</option>
						{/each}
					{/if}
				</select>
			</label>
			<button
				type="button"
				class="btn-accent mt-3 w-full cursor-pointer px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
				disabled={!replacement}
				onclick={() => finish({ action: 'reassign', replacement })}
			>
				Reassign and remove
			</button>
		</div>

		<div class="rounded-xl border border-color bg-primary p-4">
			<p class="text-sm font-semibold text-primary">Leave the segments without a speaker</p>
			<p class="mt-1 text-xs leading-relaxed text-secondary">
				The affected segments will be marked as <strong>Unassigned</strong> and can be reviewed later.
			</p>
			<button
				type="button"
				class="mt-3 w-full cursor-pointer rounded-lg border border-red-400/50 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/15"
				onclick={() => finish({ action: 'unassigned' })}
			>
				Mark unassigned and remove
			</button>
		</div>
	</div>

	<div class="mt-5 flex justify-end">
		<button
			type="button"
			class="btn cursor-pointer px-5 py-2 text-sm"
			onclick={() => finish({ action: 'cancel' })}
		>
			Cancel
		</button>
	</div>
</div>
