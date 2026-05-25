<script lang="ts">
	import { slide } from 'svelte/transition';

	let {
		text,
		yesNo = false,
		resolve
	}: {
		text: string;
		yesNo?: boolean;
		resolve: (result: boolean) => void;
	} = $props();
</script>

<div
	class="bg-secondary border border-color rounded-2xl w-[500px] max-w-[90vw] p-6 shadow-2xl shadow-black/50
	       flex flex-col relative backdrop-blur-sm"
	transition:slide
>
	<!-- Header with icon -->
	<div class="flex items-center gap-3 mb-4">
		<div class="flex items-center justify-center w-10 h-10 bg-accent rounded-full">
			<span class="material-icons text-lg text-accent">help_outline</span>
		</div>
		<h2 class="text-lg font-semibold text-primary">{!yesNo ? 'Confirmation' : 'Question'}</h2>
	</div>

	<!-- Divider -->
	<div class="w-full h-px bg-gradient-to-r from-transparent via-border-color to-transparent"></div>

	<!-- Content -->
	<div class="mb-5">
		<p class="text-secondary whitespace-pre-line leading-relaxed text-sm">{text}</p>
	</div>

	<!-- Action buttons -->
	<div class="flex justify-end gap-3">
		<button
			class="btn px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105"
			onclick={(e) => {
				e.stopPropagation();
				resolve(false);
			}}
		>
			{yesNo ? 'No' : 'Cancel'}
		</button>
		<button
			class="btn-accent px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:scale-105
			       shadow-lg hover:shadow-xl"
			onclick={(e) => {
				e.stopPropagation();
				resolve(true);
			}}
		>
			{yesNo ? 'Yes' : 'Confirm'}
		</button>
	</div>
</div>
