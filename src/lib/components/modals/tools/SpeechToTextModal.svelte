<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { AssetClip, TrackType } from '$lib/classes';
	import Settings, { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { transcribeProjectAudio, type SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '$lib/components/modals/ModalManager';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	let settings = $state(untrack(() => ({ ...globalState.settings!.speechToTextSettings })));
	let selectedClipId = $state(0);
	let busy = $state(false);
	let errorMessage = $state('');
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
		settings.provider === 'groq'
			? globalState.settings!.speechToTextSettings.groqApiKey
			: globalState.settings!.speechToTextSettings.elevenLabsApiKey
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
			const current = globalState.settings!.speechToTextSettings;
			globalState.settings!.speechToTextSettings = {
				...settings,
				groqApiKey: current.groqApiKey,
				elevenLabsApiKey: current.elevenLabsApiKey
			};
			await Settings.save();
			if (notify) toast.success(copy.saved());
			return true;
		} catch {
			errorMessage = copy.saveError();
			return false;
		}
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
	 * Ouvre l'onglet dédié aux clés de transcription dans les paramètres.
	 * @returns {void}
	 */
	function openTranscriptKeys(): void {
		globalState.uiState.settingsTab = SettingsTab.TRANSCRIPT_KEY;
		globalState.uiState.isSettingsOpen = true;
		dismiss();
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
			const overwrite = project.content.timeline.getFirstTrack(TrackType.Subtitle).clips.length > 0;
			if (overwrite && !(await ModalManager.confirmModal(copy.overwriteConfirm()))) return;
			if (controller.signal.aborted || globalState.currentProject !== project) return;
			if (!(await saveSettings(false))) return;
			if (controller.signal.aborted) return;
			await transcribeProjectAudio(
				project,
				selectedClipId,
				{ ...globalState.settings!.speechToTextSettings },
				controller.signal,
				(nextPhase, value) => {
					phase = nextPhase;
					progress = Math.round(
						(nextPhase === 'transcribing' ? value * 0.8 : 0.8 + value * 0.2) * 100
					);
				},
				overwrite
			);
			toast.success(copy.complete());
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
				<div class="space-y-2">
					<button
						type="button"
						onclick={openTranscriptKeys}
						class="cursor-pointer text-sm text-accent underline underline-offset-4"
						>{copy.transcriptKeySettings()}</button
					>
					{#if !key.trim()}<p class="text-xs text-amber-400">{copy.keyRequired()}</p>{/if}
				</div>
				<label class="block space-y-1 text-sm text-secondary"
					><span>{$LL.common.language()}</span>
					<input bind:value={settings.language} maxlength="3" class={inputClass} />
					<span class="block text-xs text-thirdly">{copy.languageHint()}</span>
				</label>
				<h3 class="pt-2 text-sm font-semibold text-primary">{copy.preferences()}</h3>
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
				<div class="grid grid-cols-2 gap-3">
					<label class="space-y-1 text-sm text-secondary">
						<span>{copy.paddingBefore()}</span>
						<input
							type="number"
							min="0"
							step="1"
							required
							bind:value={settings.paddingBeforeMs}
							class={inputClass}
						/>
					</label>
					<label class="space-y-1 text-sm text-secondary">
						<span>{copy.paddingAfter()}</span>
						<input
							type="number"
							min="0"
							step="1"
							required
							bind:value={settings.paddingAfterMs}
							class={inputClass}
						/>
					</label>
				</div>
				<p class="text-xs text-thirdly">{copy.paddingHint()}</p>
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
				disabled={busy || !selectedClipId || !key.trim()}
				class="btn-accent px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				>{copy.start()}</button
			>
		</footer>
	</form>
</div>
