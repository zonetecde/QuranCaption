<script lang="ts">
	import { openUrl } from '@tauri-apps/plugin-opener';
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';
	import type { UpdateInfo } from '$lib/services/VersionService.svelte';

	let { update, resolve }: { update: UpdateInfo; resolve: () => void } = $props();

	/**
	 * Ferme la modale et mémorise son affichage pendant 24 heures.
	 *
	 * @returns {void}
	 */
	function dismiss(): void {
		if (globalState.settings) {
			globalState.settings.persistentUiState.lastClosedUpdateModal = new Date().toISOString();
			void Settings.save();
		}
		resolve();
	}

	/**
	 * Ouvre la release GitHub contenant le nouvel APK.
	 *
	 * @returns {Promise<void>} Résolution après l'ouverture de la release.
	 */
	async function openRelease(): Promise<void> {
		try {
			await openUrl(update.releaseUrl);
			dismiss();
		} catch (error) {
			console.error('Unable to open Android release:', error);
		}
	}
</script>

<div
	class="relative flex max-h-[min(92vh,42rem)] w-[min(100%-1.5rem,36rem)] flex-col overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl shadow-black"
	use:mobileModalSheet={dismiss}
>
	<header
		class="flex items-center justify-between border-b border-color bg-gradient-to-r from-accent to-bg-accent px-4 py-4"
	>
		<div class="flex min-w-0 items-center gap-3">
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-primary"
			>
				<span class="material-icons text-xl text-black">system_update</span>
			</div>
			<div class="min-w-0">
				<h2 class="truncate text-xl font-bold text-primary">{$LL.home.updateAvailableTitle()}</h2>
				<p class="text-sm text-thirdly">
					{$LL.home.versionXReady({ version: update.latestVersion })}
				</p>
			</div>
		</div>
		<button
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-secondary"
			onclick={dismiss}
			aria-label={$LL.common.close()}
		>
			<span class="material-icons">close</span>
		</button>
	</header>

	<section class="min-h-0 flex-1 overflow-y-auto p-4">
		<h3 class="mb-3 text-base font-semibold text-primary">{$LL.home.whatsNew()}</h3>
		<pre
			class="whitespace-pre-wrap rounded-xl border border-color bg-primary p-4 font-sans text-sm leading-relaxed text-secondary">{update.changelog}</pre>
	</section>

	<footer class="flex gap-3 border-t border-color p-4">
		<button class="btn min-w-0 flex-1" onclick={dismiss}>{$LL.home.later()}</button>
		<button class="btn-accent min-w-0 flex-1" onclick={() => void openRelease()}>
			<span class="material-icons mr-2 text-lg align-middle">download</span>
			{$LL.home.downloadManually()}
		</button>
	</footer>
</div>
