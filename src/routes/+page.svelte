<script>
	import Home from '$lib/components/home/Home.svelte';
	import DonationFloatingButton from '$lib/components/misc/DonationFloatingButton.svelte';
	import ProjectEditor from '$lib/components/projectEditor/ProjectEditor.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ShortcutService from '$lib/services/ShortcutService';
	import { discordService } from '$lib/services/DiscordService';
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-5-french-toast';
	import Settings from '$lib/classes/Settings.svelte';

	onMount(async () => {
		// Init le gestionnaire de shortcuts
		ShortcutService.init();

		// Charge les paramètres utilisateur (une seconde fois pour être sûr)
		Settings.load();

		// Initialiser Discord Rich Presence
		discordService
			.init()
			.then(() => {
				discordService.setIdleState();
			})
			.catch((err) => {
				console.error('Failed to initialize Discord Rich Presence:', err);
			});
	});
</script>

<Toaster />

<div class="flex flex-col h-screen overflow-hidden">
	<!-- Barre de titre fixe -->
	<TitleBar />

	<!-- Zone de contenu avec scroll -->
	<main class="flex-1 overflow-auto mt-10">
		{#if globalState.currentProject === null}
			<Home />
		{:else}
			<ProjectEditor />
		{/if}
		<DonationFloatingButton />
	</main>
</div>
