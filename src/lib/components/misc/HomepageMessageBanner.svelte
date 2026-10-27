<script lang="ts">
	import { onMount } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import {
		getHomepageMessage,
		type HomepageMessage
	} from '$lib/services/StylePresetLibraryService';

	let message = $state<HomepageMessage | null>(null);
	let dismissed = $state(false);
	let actionUrl = $derived(message?.playStoreUrl || message?.qrCodeUrl);

	/**
	 * Masque cette annonce jusqu'à la publication d'un nouveau contenu.
	 * @returns {Promise<void>} Résout après la sauvegarde de la préférence.
	 */
	async function dismiss(): Promise<void> {
		dismissed = true;
		if (!message || !globalState.settings) return;
		globalState.settings.persistentUiState.dismissedHomepageMessageFingerprint =
			message.fingerprint;
		try {
			await Settings.save();
		} catch (error) {
			console.error('Failed to save announcement dismissal:', error);
		}
	}

	onMount(() => {
		let cancelled = false;
		void getHomepageMessage()
			.then((value) => {
				if (!cancelled) message = value;
			})
			.catch((error) => console.error('Failed to load homepage announcement:', error));
		return () => {
			cancelled = true;
		};
	});
</script>

{#if message?.enabled && message.title && message.description && !dismissed && message.fingerprint !== globalState.settings?.persistentUiState.dismissedHomepageMessageFingerprint && !globalState.uiState.isTourActive}
	<section class="bg-secondary border-color mb-6 rounded-2xl border p-5" aria-label={message.title}>
		<div class="flex items-start justify-between gap-4">
			<div>
				<h2 class="text-primary text-lg font-bold">{message.title}</h2>
				<p class="text-secondary mt-2 whitespace-pre-line">{message.description}</p>
			</div>
			<button
				class="btn btn-icon"
				type="button"
				onclick={dismiss}
				aria-label={$LL.common.dismiss()}
			>
				<span class="material-icons-outlined">close</span>
			</button>
		</div>
		{#if message.imageUrls.length}
			<div class="mt-4 flex gap-3 overflow-x-auto">
				{#each message.imageUrls as url (url)}
					<img src={url} alt={message.title} class="h-44 rounded-xl object-contain" />
				{/each}
			</div>
		{/if}
		{#if actionUrl}
			<button
				class="btn-accent mt-4 rounded-xl px-4 py-2"
				type="button"
				onclick={() => void openUrl(actionUrl!)}
			>
				{new URL(actionUrl).hostname}
			</button>
		{/if}
	</section>
{/if}
