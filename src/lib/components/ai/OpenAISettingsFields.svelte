<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { maskApiKey } from '$lib/services/AdvancedAITrimming';
	import LL from '$lib/i18n/i18n-svelte';

	type TextAiPreset = {
		id: string;
		label: string;
		endpoint: string;
		model: string;
		description: string;
	};

	let {
		showAdvancedTrimToggle = false,
		onSettingsChanged = () => {},
		onBatchSettingsChanged = () => {},
		onCandidatesChanged = () => {}
	}: {
		showAdvancedTrimToggle?: boolean;
		onSettingsChanged?: () => void;
		onBatchSettingsChanged?: () => void;
		onCandidatesChanged?: () => void;
	} = $props();

	const TEXT_AI_PRESETS: TextAiPreset[] = [
		{
			id: 'openai',
			label: 'OpenAI',
			endpoint: 'https://api.openai.com/v1/responses',
			model: 'gpt-5.4',
			description: 'Responses API'
		},
		{
			id: 'gemini',
			label: 'Gemini',
			endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
			model: '3.1-flash-lite',
			description: 'Google OpenAI-compatible'
		},
		{
			id: 'openrouter',
			label: 'OpenRouter',
			endpoint: 'https://openrouter.ai/api/v1/chat/completions',
			model: 'z-ai/glm-4.5-air:free',
			description: 'Free GLM preset'
		},
		{
			id: 'groq',
			label: 'Groq',
			endpoint: 'https://api.groq.com/openai/v1/chat/completions',
			model: 'llama-3.3-70b-versatile',
			description: 'Fast chat completions'
		},
		{
			id: 'deepseek',
			label: 'DeepSeek',
			endpoint: 'https://api.deepseek.com/chat/completions',
			model: 'deepseek-chat',
			description: 'DeepSeek chat preset'
		}
	];

	/**
	 * Applique un preset rapide sans modifier la cle API.
	 * @param {TextAiPreset} preset Preset a copier dans les champs endpoint et model.
	 * @returns {void}
	 */
	function applyTextAiPreset(preset: TextAiPreset): void {
		globalState.settings!.aiTranslationSettings.textAiApiEndpoint = preset.endpoint;
		globalState.settings!.aiTranslationSettings.advancedTrimModel = preset.model;
		onSettingsChanged();
		onBatchSettingsChanged();
	}
</script>

<div class="grid gap-4 md:grid-cols-2">
	<div class="space-y-2 md:col-span-2">
		<div class="flex items-center justify-between gap-3">
			<span class="text-sm font-medium text-secondary">{$LL.aiVideo.quickPresets()}</span>
			<span class="text-xs text-thirdly">{$LL.aiVideo.loadsEndpointModel()}</span>
		</div>

		<div class="grid gap-2 grid-cols-3">
			{#each TEXT_AI_PRESETS as preset}
				<button
					type="button"
					class="flex min-h-14 flex-col items-start justify-between rounded-lg border border-color bg-secondary px-2 py-2 text-left transition-colors hover:border-[var(--accent-primary)]/50 hover:bg-tertiary"
					onclick={() => applyTextAiPreset(preset)}
				>
					<span class="text-sm font-medium text-primary">{preset.label}</span>
					<span class="line-clamp-1 text-[11px] text-thirdly">{preset.model}</span>
				</button>
			{/each}
		</div>
	</div>

	<label class="space-y-2 md:col-span-2">
		<span class="text-sm font-medium text-secondary">{$LL.aiVideo.aiApiKeyLabel()}</span>
		<input
			type="password"
			bind:value={globalState.settings!.aiTranslationSettings.openAiApiKey}
			onblur={onSettingsChanged}
			placeholder={$LL.aiVideo.providerApiKeyPlaceholder()}
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<span class="text-xs text-thirdly">
			{$LL.aiVideo.apiKeyStoredHint({
				value: maskApiKey(globalState.settings!.aiTranslationSettings.openAiApiKey)
			})}
		</span>
	</label>

	<label class="space-y-2 md:col-span-2">
		<span class="text-sm font-medium text-secondary">{$LL.aiVideo.textAiEndpoint()}</span>
		<input
			type="url"
			bind:value={globalState.settings!.aiTranslationSettings.textAiApiEndpoint}
			onblur={onSettingsChanged}
			placeholder={$LL.aiVideo.textAiEndpointPlaceholder()}
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<span class="text-xs text-thirdly">
			{$LL.aiVideo.textAiEndpointDescription()}
		</span>
	</label>

	<label class="space-y-2">
		<span class="text-sm font-medium text-secondary">{$LL.aiVideo.modelLabelSpan()}</span>
		<input
			list="text-ai-model-suggestions"
			bind:value={globalState.settings!.aiTranslationSettings.advancedTrimModel}
			onblur={onBatchSettingsChanged}
			placeholder={$LL.aiVideo.modelPlaceholder()}
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<datalist id="text-ai-model-suggestions">
			<option value="gpt-5.4"></option>
			<option value="gpt-5.4-mini"></option>
			<option value="gpt-5.4-nano"></option>
			<option value="3.1-flash-lite"></option>
			<option value="gemini-2.5-flash"></option>
			<option value="z-ai/glm-4.5-air:free"></option>
			<option value="llama-3.3-70b-versatile"></option>
			<option value="deepseek-chat"></option>
		</datalist>
	</label>

	<label class="space-y-2">
		<span class="text-sm font-medium text-secondary">{$LL.aiVideo.reasoningEffort()}</span>
		<select
			bind:value={globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort}
			onchange={onBatchSettingsChanged}
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		>
			<option value="none">none</option>
			<option value="low">low</option>
			<option value="medium">medium</option>
			<option value="high">high</option>
		</select>
	</label>
</div>

{#if showAdvancedTrimToggle}
	<label
		class="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--accent-primary)]/40 bg-secondary px-3 py-3"
	>
		<input
			type="checkbox"
			bind:checked={globalState.settings!.aiTranslationSettings.advancedAlsoAskReviewed}
			onchange={onCandidatesChanged}
			class="h-4 w-4 rounded"
		/>
		<div>
			<div class="text-sm font-medium text-primary">{$LL.aiVideo.alsoAskReviewed()}</div>
			<div class="text-xs text-thirdly">{$LL.aiVideo.alsoAskReviewedDescription()}</div>
		</div>
	</label>
{/if}
