<script lang="ts">
	import DonationFloatingButton from '$lib/components/misc/DonationFloatingButton.svelte';
	import { onMount } from 'svelte';
	import '../app.css';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import { Toaster } from 'svelte-5-french-toast';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
	import { on } from 'svelte/events';
	import { browser } from '$app/environment';
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import posthog from 'posthog-js';

	let { children } = $props();

	if (browser) {
		afterNavigate(() => posthog.capture('$pageview'));
	}

	onMount(() => {
		initializeClassRegistry();
	});

	const currentTheme = $derived(globalState.settings?.persistentUiState?.theme || 'default');

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
