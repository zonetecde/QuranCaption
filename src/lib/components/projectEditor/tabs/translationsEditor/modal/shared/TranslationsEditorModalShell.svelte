<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';

	let {
		close,
		title,
		icon,
		shellClass = '',
		bodyClass = 'flex-1 min-h-0 overflow-hidden',
		iconContainerClass = 'w-10 h-10',
		iconClass = 'text-xl',
		subtitle,
		afterHeader,
		children
	}: {
		close: () => void;
		title: string;
		icon: string;
		shellClass?: string;
		bodyClass?: string;
		iconContainerClass?: string;
		iconClass?: string;
		subtitle?: Snippet;
		afterHeader?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div
	class={`bg-secondary border-color border rounded-2xl shadow-2xl shadow-black flex flex-col relative overflow-hidden ${shellClass}`}
	transition:slide
>
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3 min-w-0">
				<div
					class={`${iconContainerClass} bg-accent-primary rounded-full flex items-center justify-center flex-shrink-0`}
				>
					<span class={`material-icons text-black ${iconClass}`}>{icon}</span>
				</div>
				<div class="min-w-0">
					<h2 class="text-xl font-bold text-primary">{title}</h2>
					<p class="text-sm text-thirdly">
						{@render subtitle?.()}
					</p>
				</div>
			</div>

			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	{@render afterHeader?.()}

	<div class={bodyClass}>
		{@render children?.()}
	</div>
</div>
