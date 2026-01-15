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

	$effect(() => {
		if (!browser) return;
		const theme = globalState.settings?.persistentUiState?.theme || 'default';

		document.body.classList.remove(
			'theme-blue-ocean',
			'theme-orange-mechanic',
			'theme-blue-light-ocean',
			'theme-cyber-violet',
			'theme-emerald-forest',
			'theme-polar-ice',
			'theme-desert-gold'
		);
		if (theme === 'blue-ocean') {
			document.body.classList.add('theme-blue-ocean');
		} else if (theme === 'orange-mechanic') {
			document.body.classList.add('theme-orange-mechanic');
		} else if (theme === 'blue-light-ocean') {
			document.body.classList.add('theme-blue-light-ocean');
		} else if (theme === 'cyber-violet') {
			document.body.classList.add('theme-cyber-violet');
		} else if (theme === 'emerald-forest') {
			document.body.classList.add('theme-emerald-forest');
		} else if (theme === 'polar-ice') {
			document.body.classList.add('theme-polar-ice');
		} else if (theme === 'desert-gold') {
			document.body.classList.add('theme-desert-gold');
		}
	});
</script>

{@render children()}
