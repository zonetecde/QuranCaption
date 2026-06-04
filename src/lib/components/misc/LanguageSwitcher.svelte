<script lang="ts">
	import { setLocale, locale } from '$lib/i18n/i18n-svelte';
	import type { Locales } from '$lib/i18n/i18n-types';
	import { globalState } from '$lib/runes/main.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	function switchLanguage(lang: Locales) {
		setLocale(lang);
		if (globalState.settings) {
			globalState.settings.persistentUiState.language = lang;
			Settings.save();
		}
	}
</script>

<div class="flex items-center gap-2">
	<span class="text-xs text-thirdly mr-1">{$LL.common.language()}</span>
	<button
		class="btn btn-sm {$locale === 'en' ? 'btn-accent' : ''}"
		onclick={() => switchLanguage('en')}
	>
		EN
	</button>
	<button
		class="btn btn-sm {$locale === 'fr' ? 'btn-accent' : ''}"
		onclick={() => switchLanguage('fr')}
	>
		FR
	</button>
</div>
