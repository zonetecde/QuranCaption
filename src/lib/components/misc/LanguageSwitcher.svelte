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

	const languageOptions: { value: Locales; label: string }[] = [
		{ value: 'en', label: 'English' },
		{ value: 'fr', label: 'Fran\u00e7ais' },
		{ value: 'de', label: 'Deutsch' },
		{ value: 'es', label: 'Espa\u00f1ol' },
		{ value: 'zh', label: '\u4e2d\u6587' }
	];
</script>

<div class="flex flex-col gap-1.5">
	<label for="language-switcher" class="text-xs text-thirdly">{$LL.common.language()}</label>
	<div class="relative">
		<select
			id="language-switcher"
			class="w-full appearance-none rounded-lg border border-color bg-secondary px-3 py-2 pr-8 text-sm text-primary"
			value={$locale}
			onchange={(e) => switchLanguage((e.target as HTMLSelectElement).value as Locales)}
		>
			{#each languageOptions as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
		<span
			class="material-icons pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px]! text-thirdly"
		>
			expand_more
		</span>
	</div>
</div>
