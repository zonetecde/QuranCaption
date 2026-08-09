<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import OpenAISettingsFields from '$lib/components/ai/OpenAISettingsFields.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import StockMediaSettings from './StockMediaSettings.svelte';

	let activeTab = $state<'ai' | 'stock'>('ai');
	let copy = $derived($LL.settings as unknown as { apiKeys: () => string });

	function persistSettings(): void {
		void Settings.save();
	}
</script>

<div class="space-y-5">
	<h3 class="text-lg font-medium text-primary">{copy.apiKeys()}</h3>

	<div class="flex rounded-xl border border-color bg-primary p-1" role="tablist">
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'ai'}
			class="min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
			class:bg-accent-primary={activeTab === 'ai'}
			class:text-black={activeTab === 'ai'}
			class:text-secondary={activeTab !== 'ai'}
			onclick={() => (activeTab = 'ai')}
		>
			{$LL.settings.aiKey()}
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeTab === 'stock'}
			class="min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
			class:bg-accent-primary={activeTab === 'stock'}
			class:text-black={activeTab === 'stock'}
			class:text-secondary={activeTab !== 'stock'}
			onclick={() => (activeTab = 'stock')}
		>
			{$LL.settings.stockMedia()}
		</button>
	</div>

	{#if activeTab === 'ai'}
		<div>
			<h3 class="text-lg font-medium text-primary">{$LL.settings.aiKey()}</h3>
			<p class="mt-1 text-sm text-thirdly">
				{$LL.common.aiKeyDescription()}
			</p>
		</div>

		<div class="rounded-xl border border-color bg-primary p-4">
			<OpenAISettingsFields
				showAdvancedTrimToggle={true}
				onSettingsChanged={persistSettings}
				onBatchSettingsChanged={persistSettings}
				onCandidatesChanged={persistSettings}
			/>
		</div>
	{:else}
		<StockMediaSettings />
	{/if}
</div>
