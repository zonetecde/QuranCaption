<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';

	let { onClose } = $props<{ onClose: () => void }>();
</script>

<header class="border-b border-color bg-gradient-to-r from-accent to-bg-accent px-6 py-4">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent-primary">
				<span class="material-icons text-black">auto_awesome</span>
			</div>
			<div>
				<h2 class="text-xl font-semibold text-primary">{$LL.editor.aiSegmentationHeading()}</h2>
				<p class="text-sm text-tertiary">
					{$LL.editor.autoSegmentAudio()}
				</p>
			</div>
		</div>

		<button
			type="button"
			class="flex h-9 w-9 items-center justify-center rounded-full text-secondary transition-colors hover:bg-[rgba(255,255,255,0.1)] hover:text-primary"
			onclick={onClose}
		>
			<span class="material-icons">close</span>
		</button>
	</div>
</header>
