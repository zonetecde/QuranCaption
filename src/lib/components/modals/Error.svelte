<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { slide } from 'svelte/transition';

	let {
		title,
		message,
		logs,
		resolve
	}: {
		title: string;
		message: string;
		logs?: string;
		resolve: () => void;
	} = $props();
</script>

<div
	class="bg-secondary border border-color rounded-2xl w-[500px] max-w-[90vw] p-6 shadow-2xl shadow-black/50
	       flex flex-col relative backdrop-blur-sm"
	transition:slide
>
	<!-- Header with error icon -->
	<div class="flex items-center gap-3 mb-6">
		<div class="flex items-center justify-center w-10 h-10 bg-red-500/20 rounded-full">
			<span class="material-icons text-lg text-red-500">error_outline</span>
		</div>
		<h2 class="text-lg font-semibold text-primary">{title}</h2>
	</div>

	<!-- Divider -->
	<div
		class="w-full h-px bg-gradient-to-r from-transparent via-border-color to-transparent mb-6"
	></div>

	<!-- Content -->
	<div class="mb-8 space-y-4">
		<p class="text-secondary leading-relaxed text-sm">{message}</p>

		{#if logs}
			<div class="relative">
				<details class="bg-accent relative border border-color rounded-lg max-h-[400px]">
					<summary
						class="px-4 py-3 text-sm font-medium text-primary cursor-pointer hover:bg-primary/10 transition-colors duration-200 h-full"
					>
						Show technical details
					</summary>
					<div class="px-4 py-3 border-t border-color bg-primary/5">
						<pre
							class="text-xs text-thirdly font-mono whitespace-pre-wrap overflow-x-auto overflow-y-auto max-h-[300px]">{logs}</pre>
					</div>
				</details>

				<button
					class="absolute top-3 right-2 px-2 text-sm bg-primary/10 hover:bg-primary/20 rounded-2xl transition-colors duration-200 flex items-center gap-1 z-20 cursor-pointer"
					onclick={(e) => {
						e.stopPropagation();
						navigator.clipboard.writeText(logs ?? '');
						toast.success('Logs copied to clipboard');
					}}
				>
					<span class="material-icons text-[19px]">content_copy</span>
					Copy
				</button>
			</div>
		{/if}
	</div>

	<!-- Action button -->
	<div class="flex justify-end">
		<button
			class="btn-accent px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105
				   shadow-lg hover:shadow-xl"
			onclick={() => {
				resolve();
			}}
		>
			OK
		</button>
	</div>
</div>
