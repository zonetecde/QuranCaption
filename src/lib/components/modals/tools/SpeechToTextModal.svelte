<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { AssetClip, TrackType } from '$lib/classes';
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { transcribeProjectAudio, type SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import toast from 'svelte-5-french-toast';
	import { openUrl } from '@tauri-apps/plugin-opener';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	let settings = $state(untrack(() => ({ ...globalState.settings!.speechToTextSettings })));
	let speaker = $state(
		untrack(
			() => project.projectEditorState.subtitlesEditor.selectedSpeaker || project.detail.speaker
		)
	);
	let selectedClipId = $state(0);
	let busy = $state(false);
	let errorMessage = $state('');
	let showKeyHelp = $state(false);
	let phase = $state<'transcribing' | 'segmenting'>('transcribing');
	let progress = $state(0);
	const controller = new AbortController();
	const copy = $derived(($LL.editor as unknown as { speechToText: SpeechToTextCopy }).speechToText);
	const audioOptions = $derived(
		(project.content.timeline.tracks.find((track) => track.type === TrackType.Audio)?.clips ?? [])
			.filter((clip): clip is AssetClip => clip instanceof AssetClip)
			.map((clip) => ({ clip, asset: project.content.getAssetById(clip.assetId) }))
			.filter((option) => option.asset)
	);
	const key = $derived(
		settings.provider === 'groq' ? settings.groqApiKey : settings.elevenLabsApiKey
	);
	const inputClass =
		'w-full rounded-lg border border-color bg-primary px-3 py-2 text-sm text-primary';

	$effect(() => {
		if (!audioOptions.some((option) => option.clip.id === selectedClipId))
			selectedClipId = audioOptions[0]?.clip.id ?? 0;
	});
	onDestroy(() => controller.abort());

	/**
	 * Enregistre uniquement les réglages personnels de transcription.
	 * @param {boolean} notify Affiche une confirmation après sauvegarde.
	 * @returns {Promise<boolean>} Vrai si la sauvegarde a réussi.
	 */
	async function saveSettings(notify: boolean): Promise<boolean> {
		try {
			globalState.settings!.speechToTextSettings = { ...settings };
			await Settings.save();
			if (notify) toast.success(copy.saved());
			return true;
		} catch {
			errorMessage = copy.saveError();
			return false;
		}
	}

	/**
	 * Sauvegarde le brouillon puis ouvre les réglages IA textuels existants.
	 * @returns {Promise<void>}
	 */
	async function openTextAiSettings(): Promise<void> {
		if (!(await saveSettings(false))) return;
		globalState.uiState.settingsTab = SettingsTab.AI_KEY;
		globalState.uiState.isSettingsOpen = true;
		close();
	}

	/**
	 * Annule les prochaines requêtes et empêche l'ajout d'un résultat après fermeture.
	 * @returns {void}
	 */
	function dismiss(): void {
		controller.abort();
		close();
	}

	/**
	 * Transcrit la portion audio sélectionnée et applique un résultat validé au projet.
	 * @returns {Promise<void>}
	 */
	async function transcribe(): Promise<void> {
		if (busy) return;
		errorMessage = '';
		busy = true;
		try {
			if (!(await saveSettings(false))) return;
			const result = await transcribeProjectAudio(
				project,
				selectedClipId,
				{ ...settings },
				speaker,
				controller.signal,
				(nextPhase, value) => {
					phase = nextPhase;
					progress = Math.round(
						(nextPhase === 'transcribing' ? value * 0.8 : 0.8 + value * 0.2) * 100
					);
				}
			);
			toast.success(copy.complete());
			if (result.semanticFallback) toast(copy.fallback(), { duration: 10000 });
			close();
		} catch (error) {
			if (!controller.signal.aborted)
				errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<div
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-labelledby="speech-to-text-title"
	class="flex max-h-[90vh] w-[600px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl"
>
	<header class="flex items-start justify-between gap-4 border-b border-color bg-accent p-5">
		<div>
			<h2 id="speech-to-text-title" class="text-xl font-bold text-primary">{copy.title()}</h2>
			<p class="mt-1 text-sm text-secondary">{copy.description()}</p>
		</div>
		<button
			type="button"
			onclick={dismiss}
			aria-label={$LL.common.close()}
			class="cursor-pointer text-secondary hover:text-primary"
		>
			<span class="material-icons">close</span>
		</button>
	</header>
	<form
		class="flex min-h-0 flex-col"
		onsubmit={(event) => {
			event.preventDefault();
			void transcribe();
		}}
	>
		<div class="space-y-4 overflow-y-auto p-5">
			<fieldset disabled={busy} class="space-y-4 disabled:opacity-60">
				<label class="block space-y-1 text-sm text-secondary">
					<span>{copy.selectAudio()}</span>
					<select class={inputClass} bind:value={selectedClipId} disabled={!audioOptions.length}>
						{#each audioOptions as option (option.clip.id)}
							<option value={option.clip.id}
								>{option.asset!.fileName} ({(option.clip.startTime / 1000).toFixed(1)}–{(
									option.clip.endTime / 1000
								).toFixed(1)} s)</option
							>
						{/each}
					</select>
				</label>
				{#if !audioOptions.length}<p class="text-sm text-amber-400">{copy.noAudio()}</p>{/if}
				<div class="grid grid-cols-2 gap-3">
					<label class="space-y-1 text-sm text-secondary"
						><span>{copy.provider()}</span>
						<select bind:value={settings.provider} class={inputClass}>
							<option value="groq">Groq</option><option value="elevenlabs">ElevenLabs</option>
						</select>
					</label>
					<label class="space-y-1 text-sm text-secondary"
						><span>{copy.model()}</span>
						{#if settings.provider === 'groq'}
							<select bind:value={settings.groqModel} class={inputClass}>
								<option value="whisper-large-v3">Whisper Large V3</option>
								<option value="whisper-large-v3-turbo">Whisper Large V3 Turbo</option>
							</select>
						{:else}
							<select bind:value={settings.elevenLabsModel} class={inputClass}>
								<option value="scribe_v2">Scribe v2</option><option value="scribe_v1"
									>Scribe v1</option
								>
							</select>
						{/if}
					</label>
				</div>
				<div class="space-y-1 text-sm text-secondary">
					<div class="flex items-center gap-1.5">
						<label for="speech-to-text-api-key">{$LL.aiVideo.aiApiKeyLabel()}</label>
						<button
							type="button"
							aria-label={copy.keyHelp()}
							title={copy.keyHelp()}
							aria-expanded={showKeyHelp}
							aria-controls="speech-to-text-key-help"
							onclick={() => (showKeyHelp = !showKeyHelp)}
							class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-accent hover:text-primary"
						>
							<span class="material-icons text-base" aria-hidden="true">help_outline</span>
						</button>
					</div>
					{#if showKeyHelp}
						<div
							id="speech-to-text-key-help"
							class="space-y-2 rounded-lg border border-color bg-accent p-3 text-xs"
						>
							<ol class="list-decimal space-y-1.5 pl-4">
								{#each settings.provider === 'groq' ? [copy.groqKeyStep1(), copy.groqKeyStep2(), copy.groqKeyStep3()] : [copy.elevenLabsKeyStep1(), copy.elevenLabsKeyStep2(), copy.elevenLabsKeyStep3()] as step (step)}
									<li>{step}</li>
								{/each}
								<li>{copy.keyPasteStep()}</li>
							</ol>
							<button
								type="button"
								class="cursor-pointer text-accent underline"
								onclick={() =>
									openUrl(
										settings.provider === 'groq'
											? 'https://console.groq.com/keys'
											: 'https://elevenlabs.io/app/developers/api-keys'
									)}
							>
								{copy.openKeysPage()}
							</button>
						</div>
					{/if}
					{#if settings.provider === 'groq'}
						<input
							id="speech-to-text-api-key"
							type="password"
							autocomplete="off"
							bind:value={settings.groqApiKey}
							class={inputClass}
						/>
					{:else}
						<input
							id="speech-to-text-api-key"
							type="password"
							autocomplete="off"
							bind:value={settings.elevenLabsApiKey}
							class={inputClass}
						/>
					{/if}
					<span class="block text-xs text-thirdly">{copy.keyHint()}</span>
				</div>
				<label class="block space-y-1 text-sm text-secondary"
					><span>{$LL.common.language()}</span>
					<input bind:value={settings.language} maxlength="3" class={inputClass} />
					<span class="block text-xs text-thirdly">{copy.languageHint()}</span>
				</label>
				<label class="block space-y-1 text-sm text-secondary"
					><span>{$LL.editor.speaker()}</span>
					<input bind:value={speaker} required class={inputClass} />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="space-y-1 text-sm text-secondary"
						><span>{$LL.editor.maxWordsPerSegment()}</span>
						<input
							type="number"
							min="1"
							max="50"
							step="1"
							required
							bind:value={settings.maxWords}
							class={inputClass}
						/>
					</label>
					<label class="space-y-1 text-sm text-secondary"
						><span>{copy.maxDuration()}</span>
						<input
							type="number"
							min="1"
							max="30"
							step="0.5"
							required
							bind:value={settings.maxDuration}
							class={inputClass}
						/>
					</label>
				</div>
				<div class="space-y-2 rounded-lg border border-color bg-accent p-3">
					<label class="flex cursor-pointer items-center gap-2 text-sm text-primary">
						<input type="checkbox" bind:checked={settings.semanticSegmentation} />{copy.semantic()}
					</label>
					<p class="text-xs text-secondary">{copy.semanticHint()}</p>
					<button
						type="button"
						onclick={openTextAiSettings}
						class="cursor-pointer text-sm text-accent underline">{copy.textAiSettings()}</button
					>
				</div>
			</fieldset>
			{#if busy}
				<div role="status" class="space-y-2 text-sm text-secondary">
					<p>{copy[phase]()} · {progress}%</p>
					<progress max="100" value={progress} aria-label={copy[phase]()} class="w-full"></progress>
					<p class="text-xs text-thirdly">{copy.cancelHint()}</p>
				</div>
			{/if}
			{#if errorMessage}<p role="alert" class="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
					{errorMessage}
				</p>{/if}
		</div>
		<footer class="flex flex-wrap justify-end gap-2 border-t border-color p-4">
			<button type="button" onclick={dismiss} class="btn px-3 py-2">{$LL.common.cancel()}</button>
			<button type="button" disabled={busy} onclick={() => saveSettings(true)} class="btn px-3 py-2"
				>{$LL.common.save()}</button
			>
			<button
				type="submit"
				disabled={busy || !selectedClipId || !key.trim() || !speaker.trim()}
				class="btn-accent px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				>{copy.start()}</button
			>
		</footer>
	</form>
</div>
