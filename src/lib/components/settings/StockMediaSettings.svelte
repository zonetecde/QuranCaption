<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';

	function persistSettings(): void {
		void Settings.save();
	}
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-lg font-medium text-primary">{$LL.settings.stockMedia()}</h3>
		<p class="mt-1 text-sm text-thirdly">
			{$LL.settings.stockMediaDescription()}
		</p>
	</div>

	<div class="rounded-xl border border-color bg-primary p-4 space-y-4">
		<label class="space-y-2 block">
			<span class="text-sm font-medium text-secondary">{$LL.settings.pexelsApiKey()}</span>
			<input
				type="password"
				bind:value={globalState.settings!.stockMediaSettings.pexelsApiKey}
				onblur={persistSettings}
				placeholder="Pexels API key"
				class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
			/>
			<p class="text-xs text-thirdly">
				{$LL.settings.pexelsApiKeyHint()}
				<button
					type="button"
					class="text-[var(--accent-primary)] hover:underline ml-1"
					onclick={() => openUrl('https://www.pexels.com/api/key/')}
				>
					pexels.com/api/key
				</button>
			</p>
		</label>

		<label class="space-y-2 block">
			<span class="text-sm font-medium text-secondary">{$LL.settings.pixabayApiKey()}</span>
			<input
				type="password"
				bind:value={globalState.settings!.stockMediaSettings.pixabayApiKey}
				onblur={persistSettings}
				placeholder="Pixabay API key"
				class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
			/>
			<p class="text-xs text-thirdly">
				{$LL.settings.pixabayApiKeyHint()}
				<button
					type="button"
					class="text-[var(--accent-primary)] hover:underline ml-1"
					onclick={() => openUrl('https://pixabay.com/api/docs/')}
				>
					pixabay.com/api/docs
				</button>
			</p>
		</label>
	</div>
</div>
