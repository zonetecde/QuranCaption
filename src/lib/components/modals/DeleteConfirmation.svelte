<script lang="ts">
	import { slide } from 'svelte/transition';

	let {
		text,
		resolve
	}: {
		text: string;
		resolve: (result: { confirmed: boolean; deleteFile: boolean }) => void;
	} = $props();

	let alsoDeleteFromDisk = $state(false);
</script>

<div
	class="bg-secondary border border-color rounded-2xl w-[500px] max-w-[90vw] p-6 shadow-2xl shadow-black/50
	       flex flex-col relative backdrop-blur-sm"
	transition:slide
>
	<!-- Header with icon -->
	<div class="flex items-center gap-3 mb-4">
		<div class="flex items-center justify-center w-10 h-10 bg-red-500/20 rounded-full">
			<span class="material-icons text-lg text-red-400">delete</span>
		</div>
		<h2 class="text-lg font-semibold text-primary">Remove Asset</h2>
	</div>

	<!-- Divider -->
	<div class="w-full h-px bg-gradient-to-r from-transparent via-border-color to-transparent"></div>

	<!-- Content -->
	<div class="mb-5 mt-4">
		<p class="text-secondary leading-relaxed text-sm">{text}</p>

		<div
			class="mt-4 flex items-center gap-2 p-3 bg-primary/5 rounded-lg border border-color hover:bg-primary/10 transition-colors cursor-pointer"
			onclick={() => (alsoDeleteFromDisk = !alsoDeleteFromDisk)}
		>
			<input
				type="checkbox"
				bind:checked={alsoDeleteFromDisk}
				class="w-4 h-4 rounded border-gray-300 text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] cursor-pointer"
			/>
			<span class="text-sm font-medium text-primary cursor-pointer select-none"
				>Also delete file from computer</span
			>
		</div>
		{#if alsoDeleteFromDisk}
			<p class="text-xs text-red-400 mt-2 ml-1">
				<span class="font-bold">Warning:</span> This action cannot be undone.
			</p>
		{/if}
	</div>

	<!-- Action buttons -->
	<div class="flex justify-end gap-3">
		<button
			class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105"
			onclick={(e) => {
				e.stopPropagation();
				resolve({ confirmed: false, deleteFile: false });
			}}
		>
			Cancel
		</button>
		<button
			class="px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105
			       shadow-lg hover:shadow-xl rounded-lg text-white
				   bg-red-500 hover:bg-red-600"
			onclick={(e) => {
				e.stopPropagation();
				resolve({ confirmed: true, deleteFile: alsoDeleteFromDisk });
			}}
		>
			Remove
		</button>
	</div>
</div>
