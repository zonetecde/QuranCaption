<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import OpenAISettingsFields from '$lib/components/ai/OpenAISettingsFields.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	const keyPages = [
		{ name: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
		{ name: 'Gemini', url: 'https://aistudio.google.com/api-keys' },
		{ name: 'OpenRouter', url: 'https://openrouter.ai/settings/keys' },
		{ name: 'Groq', url: 'https://console.groq.com/keys' },
		{ name: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' }
	];
	const setupCopy = $derived(
		$LL.settings as unknown as {
			optionalTextAiDescription: () => string;
			manualWorkflowHint: () => string;
			textAiKeyStep1: () => string;
			textAiKeyStep2: () => string;
			textAiKeyStep3: () => string;
			textAiKeyPages: () => string;
		}
	);

	function persistSettings(): void {
		void Settings.save();
	}
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-lg font-medium text-primary">{$LL.settings.aiKey()}</h3>
		<p class="mt-1 text-sm text-thirdly">
			{$LL.common.aiKeyDescription()}
		</p>
	</div>
	<section class="space-y-3 rounded-xl border border-color bg-primary p-4">
		<p class="text-sm text-secondary">{setupCopy.optionalTextAiDescription()}</p>
		<p class="text-sm text-thirdly">{setupCopy.manualWorkflowHint()}</p>
		<ol class="list-decimal space-y-2 ps-4 text-sm text-thirdly">
			<li>{setupCopy.textAiKeyStep1()}</li>
			<li>{setupCopy.textAiKeyStep2()}</li>
			<li>{setupCopy.textAiKeyStep3()}</li>
		</ol>
		<p class="text-xs font-medium text-secondary">{setupCopy.textAiKeyPages()}</p>
		<div class="flex flex-wrap gap-3">
			{#each keyPages as provider (provider.name)}
				<button
					type="button"
					class="cursor-pointer text-xs text-accent underline underline-offset-4"
					onclick={() => openUrl(provider.url)}>{provider.name}</button
				>
			{/each}
		</div>
	</section>

	<div class="rounded-xl border border-color bg-primary p-4">
		<OpenAISettingsFields
			showAdvancedTrimToggle={true}
			onSettingsChanged={persistSettings}
			onBatchSettingsChanged={persistSettings}
			onCandidatesChanged={persistSettings}
		/>
	</div>
</div>
