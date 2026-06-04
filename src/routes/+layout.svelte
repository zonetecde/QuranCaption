<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { globalState } from '$lib/runes/main.svelte';
	import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
	import { browser } from '$app/environment';
	import { afterNavigate } from '$app/navigation';
	import { setLocale } from '$lib/i18n/i18n-svelte';
	import type { Locales } from '$lib/i18n/i18n-types';
	import posthog from 'posthog-js';

	let { children } = $props();

	if (browser) {
		afterNavigate(() => posthog.capture('$pageview'));
	}

	onMount(() => {
		initializeClassRegistry();
	});

	const currentTheme = $derived(globalState.settings?.persistentUiState?.theme || 'default');

	// Restaure la locale sauvegardée dès que les settings sont chargés
	$effect(() => {
		if (!browser) return;
		const savedLocale = globalState.settings?.persistentUiState?.language;
		if (savedLocale === 'en' || savedLocale === 'fr') {
			setLocale(savedLocale);
		}
	});

	$effect(() => {
		if (!browser) return;
		const theme = currentTheme;

		// Remove any existing theme- classes
		const currentClasses = Array.from(document.body.classList);
		currentClasses.forEach((cls) => {
			if (cls.startsWith('theme-')) {
				document.body.classList.remove(cls);
			}
		});

		// Add the new theme class if it's not 'default'
		if (theme !== 'default') {
			document.body.classList.add(`theme-${theme}`);
		}

		// Apply intensity
		const intensity = globalState.settings?.persistentUiState?.themeIntensity ?? 100;
		document.body.style.setProperty('--theme-intensity', `${intensity}%`);
	});
</script>

{@render children()}
