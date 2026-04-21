<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { maskApiKey } from '$lib/services/AdvancedAITrimming';

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
</script>

<div class="grid gap-4 md:grid-cols-2">
	<label class="space-y-2 md:col-span-2">
		<span class="text-sm font-medium text-secondary">AI API key</span>
		<input
			type="password"
			bind:value={globalState.settings!.aiTranslationSettings.openAiApiKey}
			onblur={onSettingsChanged}
			placeholder="Provider API key"
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<span class="text-xs text-thirdly">
			Stored in plain text in `settings.json`. Current value: {maskApiKey(
				globalState.settings!.aiTranslationSettings.openAiApiKey
			)}
		</span>
	</label>

	<label class="space-y-2 md:col-span-2">
		<span class="text-sm font-medium text-secondary">Text AI endpoint</span>
		<input
			type="url"
			bind:value={globalState.settings!.aiTranslationSettings.textAiApiEndpoint}
			onblur={onSettingsChanged}
			placeholder="https://api.openai.com/v1/responses"
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<span class="text-xs text-thirdly">
			Endpoint used for advanced trimming and AI bold requests.
		</span>
	</label>

	<label class="space-y-2">
		<span class="text-sm font-medium text-secondary">Model</span>
		<input
			list="text-ai-model-suggestions"
			bind:value={globalState.settings!.aiTranslationSettings.advancedTrimModel}
			onblur={onBatchSettingsChanged}
			placeholder="gpt-5.4"
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<datalist id="text-ai-model-suggestions">
			<option value="gpt-5.4"></option>
			<option value="gpt-5.4-mini"></option>
			<option value="gpt-5.4-nano"></option>
		</datalist>
	</label>

	<label class="space-y-2">
		<span class="text-sm font-medium text-secondary">Reasoning effort</span>
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
			<div class="text-sm font-medium text-primary">Also ask for already reviewed verses</div>
			<div class="text-xs text-thirdly">Include fully reviewed verses in candidate selection.</div>
		</div>
	</label>
{/if}
