<script lang="ts">
	import { onDestroy } from 'svelte';
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import type { SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import { openUrl } from '@tauri-apps/plugin-opener';

	const providers = ['groq', 'elevenlabs'] as const;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let errorMessage = $state('');
	const copy = $derived(($LL.editor as unknown as { speechToText: SpeechToTextCopy }).speechToText);
	const settingsCopy = $derived(
		$LL.settings as unknown as {
			transcriptKey: () => string;
			transcriptKeyDescription: () => string;
			groqApiKey: () => string;
			elevenLabsApiKey: () => string;
			manualWorkflowHint: () => string;
			optionalTextAiTitle: () => string;
			optionalTextAiDescription: () => string;
			configureTextAi: () => string;
		}
	);

	/**
	 * Enregistre les clés personnelles après synchronisation des champs.
	 * @returns {Promise<void>} Fin de la sauvegarde.
	 */
	async function persistSettings(): Promise<void> {
		clearTimeout(saveTimer);
		saveTimer = undefined;
		try {
			await Settings.save();
			errorMessage = '';
		} catch {
			errorMessage = copy.saveError();
		}
	}

	/**
	 * Regroupe les frappes successives avant la sauvegarde automatique.
	 * @returns {void}
	 */
	function scheduleSave(): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void persistSettings(), 400);
	}

	onDestroy(() => {
		if (saveTimer) void persistSettings();
	});
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-lg font-medium text-primary">{settingsCopy.transcriptKey()}</h3>
		<p class="mt-1 text-sm text-thirdly">{settingsCopy.transcriptKeyDescription()}</p>
		<p class="mt-2 text-sm text-secondary">{settingsCopy.manualWorkflowHint()}</p>
	</div>
	{#each providers as provider (provider)}
		<section class="space-y-3 rounded-xl border border-color bg-primary p-4">
			<label class="block space-y-2">
				<span class="text-sm font-medium text-secondary"
					>{provider === 'groq' ? settingsCopy.groqApiKey() : settingsCopy.elevenLabsApiKey()}</span
				>
				<input
					type="password"
					autocomplete="off"
					bind:value={
						globalState.settings!.speechToTextSettings[
							provider === 'groq' ? 'groqApiKey' : 'elevenLabsApiKey'
						]
					}
					oninput={scheduleSave}
					onblur={persistSettings}
					class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
				/>
			</label>
			<p class="text-xs font-medium text-secondary">{copy.keyHelp()}</p>
			<ol class="list-decimal space-y-1.5 ps-4 text-xs leading-relaxed text-thirdly">
				{#each provider === 'groq' ? [copy.groqKeyStep1(), copy.groqKeyStep2(), copy.groqKeyStep3()] : [copy.elevenLabsKeyStep1(), copy.elevenLabsKeyStep2(), copy.elevenLabsKeyStep3()] as step (step)}
					<li>{step}</li>
				{/each}
				<li>{copy.keyPasteStep()}</li>
			</ol>
			<button
				type="button"
				onclick={() =>
					openUrl(
						provider === 'groq'
							? 'https://console.groq.com/keys'
							: 'https://elevenlabs.io/app/developers/api-keys'
					)}
				class="cursor-pointer text-xs text-accent underline underline-offset-4"
				>{copy.openKeysPage()}</button
			>
		</section>
	{/each}
	<section class="space-y-3 rounded-xl border border-color bg-primary p-4">
		<h4 class="font-medium text-primary">{settingsCopy.optionalTextAiTitle()}</h4>
		<p class="text-sm text-thirdly">{settingsCopy.optionalTextAiDescription()}</p>
		<button
			type="button"
			class="cursor-pointer rounded-lg bg-accent-primary px-3 py-2 text-sm font-semibold text-[var(--text-on-accent)]"
			onclick={(event) => {
				event.currentTarget.closest('[data-settings-content]')?.scrollTo({ top: 0 });
				globalState.uiState.settingsTab = SettingsTab.AI_KEY;
			}}>{settingsCopy.configureTextAi()}</button
		>
	</section>
	{#if errorMessage}<p role="alert" class="text-sm text-red-400">{errorMessage}</p>{/if}
</div>
