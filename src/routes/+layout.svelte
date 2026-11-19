<script lang="ts">
	import '../app.css';
	import { globalState } from '$lib/runes/main.svelte';
	import { browser } from '$app/environment';
	import { locale, setLocale } from '$lib/i18n/i18n-svelte';
	import { isLocale } from '$lib/i18n/i18n-util';
	import { getLocaleDirection } from '$lib/i18n/direction';
	import {
		RIWAYAH_OPTIONS,
		getRiwayahFontFamily,
		isNonHafsRiwayah
	} from '$lib/services/RiwayahProvider';

	if (browser) {
		const riwayahFontStyle = document.createElement('style');
		const isMacOS = navigator.userAgent.toLowerCase().includes('mac');
		for (const riwayah of RIWAYAH_OPTIONS) {
			if (!isNonHafsRiwayah(riwayah)) continue;
			const baseUrl = `/riwayat/${riwayah.toLowerCase()}/font`;
			const source = isMacOS
				? `url('${baseUrl}.ttf') format('truetype')`
				: `url('${baseUrl}.woff2') format('woff2'), url('${baseUrl}.ttf') format('truetype')`;
			riwayahFontStyle.textContent += `
				@font-face {
					font-family: '${getRiwayahFontFamily(riwayah)}';
					src: ${source};
					font-weight: normal;
					font-style: normal;
				}
			`;
		}
		document.head.appendChild(riwayahFontStyle);
	}

	let { children } = $props();

	const currentTheme = $derived(globalState.settings?.persistentUiState?.theme || 'default');

	// Restaure la locale sauvegardée dès que les settings sont chargés
	$effect(() => {
		if (!browser) return;
		const savedLocale = globalState.settings?.persistentUiState?.language;
		if (savedLocale && isLocale(savedLocale)) {
			setLocale(savedLocale);
		}
	});

	$effect(() => {
		if (!browser) return;
		document.documentElement.lang = $locale;
		document.documentElement.dir = getLocaleDirection($locale);
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
		document.body.classList.toggle(
			'dimmed-modal-backdrop',
			globalState.settings?.persistentUiState.dimmedModalBackdrop ?? false
		);
	});
</script>

{@render children()}
