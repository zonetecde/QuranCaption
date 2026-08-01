<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import LL, { locale, setLocale } from '$lib/i18n/i18n-svelte';
	import type { Locales } from '$lib/i18n/i18n-types';
	import { globalState } from '$lib/runes/main.svelte';
	import { get } from 'svelte/store';

	let { confirm } = $props<{ confirm: () => void }>();
	let selectedLanguage = $state<Locales>(get(locale));

	const languageOptions: { value: Locales; label: string; flag: string }[] = [
		{ value: 'en', label: 'English', flag: '🇬🇧' },
		{ value: 'fr', label: 'Français', flag: '🇫🇷' },
		{ value: 'de', label: 'Deutsch', flag: '🇩🇪' },
		{ value: 'es', label: 'Español', flag: '🇪🇸' },
		{ value: 'id', label: 'Indonesia', flag: '🇮🇩' },
		{ value: 'zh', label: '中文', flag: '🇨🇳' }
	];

	/** Enregistre la langue initiale et reporte la bannière de soutien de trois jours. */
	async function confirmLanguage(): Promise<void> {
		const settings = globalState.settings;
		if (!settings) return;

		settings.persistentUiState.language = selectedLanguage;
		settings.persistentUiState.hasSelectedLanguage = true;
		settings.persistentUiState.lastClosedDonationBanner = new Date().toISOString();
		await Settings.save();
		confirm();
	}
</script>

<div class="modal-wrapper mobile-modal-sheet-wrapper" role="presentation">
	<div
		class="mobile-modal-sheet-panel flex flex-col border border-color bg-secondary shadow-2xl shadow-black"
		role="dialog"
		aria-modal="true"
		aria-labelledby="first-launch-language-title"
	>
		<header class="border-b border-color px-5 pb-5 pt-8 text-center">
			<div
				class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-accent-primary shadow-lg"
			>
				<span class="material-icons text-2xl text-black">translate</span>
			</div>
			<h2 id="first-launch-language-title" class="text-2xl font-bold text-primary">
				{$LL.common.language()}
			</h2>
		</header>

		<div class="flex-1 overflow-y-auto p-4">
			<div class="grid grid-cols-2 gap-3">
				{#each languageOptions as option (option.value)}
					<button
						type="button"
						class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition-colors"
						class:border-accent-primary={selectedLanguage === option.value}
						class:bg-accent={selectedLanguage === option.value}
						class:border-color={selectedLanguage !== option.value}
						class:bg-primary={selectedLanguage !== option.value}
						aria-pressed={selectedLanguage === option.value}
						onclick={() => {
							selectedLanguage = option.value;
							setLocale(option.value);
						}}
					>
						<span class="text-4xl leading-none" aria-hidden="true">{option.flag}</span>
						<span class="text-base font-semibold text-primary">{option.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<footer class="border-t border-color bg-primary p-4">
			<button class="btn-accent w-full py-3 text-base" onclick={() => void confirmLanguage()}>
				{$LL.common.confirm()}
			</button>
		</footer>
	</div>
</div>
