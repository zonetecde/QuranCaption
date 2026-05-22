<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';

	const aiv = globalState.aiVideo;
</script>

<div class="flex items-center gap-3 mt-6">
	<div class="flex items-center gap-2">
		<div
			class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold {aiv.step ===
			'input'
				? 'bg-accent-primary text-black'
				: 'bg-accent-primary/20 text-accent-primary'}"
		>
			1
		</div>
		<span
			class="text-sm {aiv.step === 'input' ? 'text-primary font-medium' : 'text-thirdly'}"
		>
			Options
		</span>
	</div>
	<div class="flex-1 h-px bg-[var(--border-color)]"></div>
	<div class="flex items-center gap-2">
		<div
			class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold {aiv.step ===
			'review'
				? 'bg-accent-primary text-black'
				: 'bg-[var(--bg-secondary)] text-thirdly border border-color'}"
		>
			2
		</div>
		<span
			class="text-sm {aiv.step === 'review' ? 'text-primary font-medium' : 'text-thirdly'}"
		>
			Review & Create
		</span>
	</div>
</div>
