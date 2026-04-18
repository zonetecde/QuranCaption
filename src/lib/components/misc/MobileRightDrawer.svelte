<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy, onMount } from 'svelte';

	let {
		open = $bindable(false),
		title = 'Panel',
		icon = 'tune',
		triggerTopClass = 'top-3',
		children
	}: {
		open?: boolean;
		title?: string;
		icon?: string;
		triggerTopClass?: string;
		children?: Snippet;
	} = $props();

	function closeDrawer(): void {
		open = false;
	}

	function handleGlobalKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			closeDrawer();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleGlobalKeyDown);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleGlobalKeyDown);
	});
</script>

<button
	class={`2xl:hidden absolute right-0 ${triggerTopClass} z-30 flex h-8 w-8 items-center justify-center rounded-l-md rounded-r-none border border-r-0 border-color bg-secondary/90 text-secondary shadow-md backdrop-blur-sm bg-accent transition hover:bg-accent hover:text-primary`}
	type="button"
	onclick={() => (open = true)}
	aria-label={`Open ${title}`}
	{title}
>
	<span class="material-icons text-[18px]">{icon}</span>
</button>

{#if open}
	<div class="2xl:hidden fixed inset-0 z-40">
		<button
			type="button"
			class="absolute inset-0 bg-black/45"
			aria-label={`Close ${title}`}
			onclick={closeDrawer}
		></button>

		<aside
			class="absolute right-0 top-0 h-full w-[88vw] max-w-[360px] border-l border-color bg-secondary shadow-2xl"
		>
			<div class="flex items-center justify-between border-b border-color px-3 py-2">
				<div class="flex items-center gap-2">
					<span class="material-icons text-accent text-lg">{icon}</span>
					<p class="text-sm font-semibold text-primary">{title}</p>
				</div>
				<button
					type="button"
					class="rounded-md p-1 text-secondary transition hover:bg-accent hover:text-primary"
					onclick={closeDrawer}
					aria-label={`Close ${title}`}
				>
					<span class="material-icons text-lg">close</span>
				</button>
			</div>
			<div class="h-[calc(100%-49px)] overflow-y-auto">
				{@render children?.()}
			</div>
		</aside>
	</div>
{/if}
