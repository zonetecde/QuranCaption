<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import type { ManualAiCopy } from '$lib/services/ManualAiSession.svelte';

	let {
		manual = $bindable(false),
		disabled = false,
		onchange
	}: { manual?: boolean; disabled?: boolean; onchange?: () => void } = $props();
	const copy = $derived(($LL.editor as unknown as { manualAi: ManualAiCopy }).manualAi);
</script>

<div class="shrink-0 border-b border-color px-4 py-2">
	<div class="flex gap-1 rounded-xl bg-primary p-1" role="tablist" aria-label={copy.method()}>
		{#each [false, true] as value (value)}
			<button
				type="button"
				role="tab"
				aria-selected={manual === value}
				tabindex={manual === value ? 0 : -1}
				onkeydown={(event) => {
					if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && !disabled) {
						event.preventDefault();
						const next = event.key === 'Home' ? false : event.key === 'End' ? true : !manual;
						if (manual !== next) {
							manual = next;
							onchange?.();
						}
						const tabs = event.currentTarget.parentElement?.querySelectorAll('button');
						tabs?.[next ? 1 : 0]?.focus();
					}
				}}
				{disabled}
				onclick={() => {
					if (manual !== value) {
						manual = value;
						onchange?.();
					}
				}}
				class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 {manual ===
				value
					? 'bg-accent text-primary shadow-sm'
					: 'text-secondary hover:text-primary'}"
			>
				<span class="material-icons shrink-0 text-lg" aria-hidden="true"
					>{value ? 'content_paste' : 'auto_awesome'}</span
				>
				{value ? copy.withoutApi() : copy.withApi()}
			</button>
		{/each}
	</div>
</div>
