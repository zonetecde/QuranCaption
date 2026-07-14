<script lang="ts">
	import type { Edition } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';

	let { close, edition }: { close: () => void; edition: Edition } = $props();
</script>

<div class="w-[560px] max-w-[92vw] rounded-2xl border border-color bg-secondary shadow-2xl">
	<header class="flex items-center justify-between border-b border-color px-5 py-4">
		<div>
			<h2 class="text-lg font-semibold text-primary">{$LL.translations.aiTranslation()}</h2>
			<p class="mt-1 text-xs text-thirdly">{edition.language}</p>
		</div>
		<button class="btn btn-icon" onclick={close} aria-label={$LL.common.close()}>
			<span class="material-icons">close</span>
		</button>
	</header>
	<div class="p-5 text-sm leading-relaxed text-secondary">
		{$LL.translations.configureTextAiFirst()}
	</div>
	<footer class="flex justify-end border-t border-color px-5 py-4">
		<button class="btn px-4 py-2" onclick={close}>{$LL.common.close()}</button>
	</footer>
</div>
