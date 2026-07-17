<script lang="ts">
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import {
		detectTextAIProvider,
		getSupportedAIReasoningModes,
		resolveAIReasoning,
		type AIReasoningMode
	} from '$lib/services/AIReasoning';

	type ReasoningCopy = {
		reasoningMode: () => string;
		reasoningAuto: () => string;
		reasoningOff: () => string;
		reasoningMinimal: () => string;
		reasoningLow: () => string;
		reasoningMedium: () => string;
		reasoningHigh: () => string;
		reasoningMaximum: () => string;
		enableThinking: () => string;
	};

	let {
		id,
		endpoint,
		model,
		mode = $bindable(),
		disabled = false,
		onchange = () => {}
	}: {
		id: string;
		endpoint: string;
		model: string;
		mode: AIReasoningMode;
		disabled?: boolean;
		onchange?: (mode: AIReasoningMode) => void;
	} = $props();

	const copy = get(LL).aiVideo as unknown as ReasoningCopy;
	const provider = $derived(detectTextAIProvider(endpoint));
	const supportedModes = $derived(getSupportedAIReasoningModes(endpoint, model));
	const resolved = $derived(resolveAIReasoning(endpoint, model, mode));
	const hasThinkingToggle = $derived(provider === 'deepseek' || provider === 'openrouter');
	const thinkingToggleDisabled = $derived(disabled || mode === 'auto');

	$effect(() => {
		if (supportedModes.includes(mode)) return;
		mode = 'auto';
		onchange(mode);
	});

	/**
	 * Met à jour le mode persistant depuis le sélecteur partagé.
	 * @param {AIReasoningMode} value Nouveau mode.
	 * @returns {void}
	 */
	function updateMode(value: AIReasoningMode): void {
		mode = value;
		onchange(mode);
	}

	/**
	 * Convertit l'interrupteur thinking en mode explicite supporté.
	 * @param {boolean} enabled État demandé.
	 * @returns {void}
	 */
	function updateThinking(enabled: boolean): void {
		mode = enabled ? 'high' : 'off';
		onchange(mode);
	}
</script>

<div class="space-y-2">
	<label class="block text-sm font-medium text-secondary" for={id}>{copy.reasoningMode()}</label>
	<select
		{id}
		class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
		value={mode}
		{disabled}
		onchange={(event) => updateMode(event.currentTarget.value as AIReasoningMode)}
	>
		{#if supportedModes.includes('auto')}<option value="auto">{copy.reasoningAuto()}</option>{/if}
		{#if supportedModes.includes('off')}<option value="off">{copy.reasoningOff()}</option>{/if}
		{#if supportedModes.includes('minimal')}<option value="minimal"
				>{copy.reasoningMinimal()}</option
			>{/if}
		{#if supportedModes.includes('low')}<option value="low">{copy.reasoningLow()}</option>{/if}
		{#if supportedModes.includes('medium')}<option value="medium">{copy.reasoningMedium()}</option
			>{/if}
		{#if supportedModes.includes('high')}<option value="high">{copy.reasoningHigh()}</option>{/if}
		{#if supportedModes.includes('maximum')}<option value="maximum"
				>{copy.reasoningMaximum()}</option
			>{/if}
	</select>
	{#if hasThinkingToggle}
		<label
			class="flex items-center gap-2 text-xs text-secondary"
			class:cursor-pointer={!thinkingToggleDisabled}
			class:cursor-not-allowed={thinkingToggleDisabled}
			class:opacity-50={thinkingToggleDisabled}
		>
			<input
				type="checkbox"
				class="h-4 w-4 rounded"
				checked={resolved.thinkingEnabled === true}
				disabled={thinkingToggleDisabled}
				onchange={(event) => updateThinking(event.currentTarget.checked)}
			/>
			<span>{copy.enableThinking()}</span>
		</label>
	{/if}
</div>
