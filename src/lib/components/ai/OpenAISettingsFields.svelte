<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { maskApiKey } from '$lib/services/AdvancedAITrimming';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import AIReasoningControls from './AIReasoningControls.svelte';
	import {
		resolveAIReasoning,
		TEXT_AI_PRESETS,
		type AIReasoningMode,
		type TextAIPreset
	} from '$lib/services/AIReasoning';

	type ReasoningSettingsCopy = {
		translationReasoning: () => string;
		cleanupReasoning: () => string;
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
	const reasoningCopy = get(LL).aiVideo as unknown as ReasoningSettingsCopy;

	/**
	 * Applique un preset rapide sans modifier la clé API.
	 * @param {TextAIPreset} preset Preset à copier dans les réglages IA.
	 * @returns {void}
	 */
	function applyTextAiPreset(preset: TextAIPreset): void {
		const settings = globalState.settings!.aiTranslationSettings;
		settings.textAiApiEndpoint = preset.endpoint;
		settings.advancedTrimModel = preset.model;
		settings.projectTranslationReasoningMode = 'auto';
		settings.transcriptCleanupReasoningMode = 'auto';
		settings.advancedTrimReasoningEffort = resolveAIReasoning(
			preset.endpoint,
			preset.model,
			'auto'
		).effort;
		onSettingsChanged();
		onBatchSettingsChanged();
	}

	/**
	 * Synchronise le nettoyage et les outils IA historiques sur le même réglage provider.
	 * @param {AIReasoningMode} mode Nouveau mode de nettoyage.
	 * @returns {void}
	 */
	function updateCleanupReasoning(mode: AIReasoningMode): void {
		const settings = globalState.settings!.aiTranslationSettings;
		settings.advancedTrimReasoningEffort = resolveAIReasoning(
			settings.textAiApiEndpoint,
			settings.advancedTrimModel,
			mode
		).effort;
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
			{#each TEXT_AI_PRESETS as preset (preset.id)}
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

	<label class="space-y-2 md:col-span-2">
		<span class="text-sm font-medium text-secondary">{$LL.aiVideo.modelLabelSpan()}</span>
		<input
			list="text-ai-model-suggestions"
			bind:value={globalState.settings!.aiTranslationSettings.advancedTrimModel}
			onblur={onBatchSettingsChanged}
			placeholder={$LL.aiVideo.modelPlaceholder()}
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		/>
		<datalist id="text-ai-model-suggestions">
			<option value="gpt-5.4-mini"></option>
			<option value="gpt-5.4"></option>
			<option value="gpt-5.4-nano"></option>
			<option value="gemini-3.1-flash-lite"></option>
			<option value="gemini-2.5-flash"></option>
			<option value="z-ai/glm-4.7-flash"></option>
			<option value="openai/gpt-oss-120b"></option>
			<option value="deepseek-v4-flash"></option>
		</datalist>
	</label>

	<div>
		<p class="mb-2 text-xs text-thirdly">{reasoningCopy.translationReasoning()}</p>
		<AIReasoningControls
			id="settings-translation-reasoning-mode"
			endpoint={globalState.settings!.aiTranslationSettings.textAiApiEndpoint}
			model={globalState.settings!.aiTranslationSettings.advancedTrimModel}
			bind:mode={globalState.settings!.aiTranslationSettings.projectTranslationReasoningMode}
			onchange={onBatchSettingsChanged}
		/>
	</div>
	<div>
		<p class="mb-2 text-xs text-thirdly">{reasoningCopy.cleanupReasoning()}</p>
		<AIReasoningControls
			id="settings-cleanup-reasoning-mode"
			endpoint={globalState.settings!.aiTranslationSettings.textAiApiEndpoint}
			model={globalState.settings!.aiTranslationSettings.advancedTrimModel}
			bind:mode={globalState.settings!.aiTranslationSettings.transcriptCleanupReasoningMode}
			onchange={updateCleanupReasoning}
		/>
	</div>
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
