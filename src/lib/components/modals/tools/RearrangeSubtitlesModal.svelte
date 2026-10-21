<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import type { SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import { rearrangeProjectSubtitles } from '$lib/services/SubtitleRearrangementService';
	import TranslationsEditorModalShell from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	let maxWords = $state(untrack(() => globalState.settings!.speechToTextSettings.maxWords));
	let maxDuration = $state(untrack(() => globalState.settings!.speechToTextSettings.maxDuration));
	let additionalPreferences = $state('');
	let busy = $state(false);
	let progress = $state(0);
	let errorMessage = $state('');
	let result = $state<{ count: number; skipped: number } | null>(null);
	const controller = new AbortController();
	const copy = $derived(($LL.editor as unknown as { speechToText: SpeechToTextCopy }).speechToText);
	const subtitles = $derived(
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)
			.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
			.sort((a, b) => a.startTime - b.startTime)
	);
	const hasTextAiKey = $derived(
		Boolean(globalState.settings?.aiTranslationSettings.openAiApiKey.trim())
	);

	const inputClass =
		'w-full rounded-lg border border-color bg-primary px-3 py-2 text-sm text-primary';
	onDestroy(() => controller.abort());

	/**
	 * Ferme le modal et empêche toute application tardive d'un résultat.
	 * @returns {void}
	 */
	function dismiss(): void {
		controller.abort();
		close();
	}

	/**
	 * Applique le découpage validé en une seule action annulable.
	 * @returns {Promise<void>}
	 */
	async function rearrange(): Promise<void> {
		if (busy) return;
		busy = true;
		progress = 0;
		errorMessage = '';
		result = null;
		try {
			result = await rearrangeProjectSubtitles(
				project,
				{ maxWords, maxDuration, additionalPreferences },
				controller.signal,
				(value) => {
					progress = Math.round(value * 100);
				}
			);
		} catch (error) {
			if (!controller.signal.aborted)
				errorMessage = error instanceof Error ? error.message : copy.rearrangeProviderError();
		} finally {
			busy = false;
		}
	}

	/**
	 * Ouvre les réglages existants du fournisseur d'IA textuelle.
	 * @returns {void}
	 */
	function openTextAiSettings(): void {
		globalState.uiState.settingsTab = SettingsTab.AI_KEY;
		globalState.uiState.isSettingsOpen = true;
		dismiss();
	}
</script>

<div role="dialog" tabindex="-1" aria-modal="true" aria-label={copy.rearrangeTitle()}>
	<TranslationsEditorModalShell
		close={dismiss}
		title={copy.rearrangeTitle()}
		icon="reorder"
		shellClass="h-[80vh] max-h-[90vh] w-[1050px] max-w-[calc(100vw-2rem)]"
		bodyClass="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden"
	>
		{#snippet subtitle()}{copy.rearrangeDescription()}{/snippet}
		<section class="flex min-h-0 flex-col border-b border-color md:border-b-0 md:border-r">
			<h3
				class="flex shrink-0 items-center justify-between border-b border-color px-5 py-3 text-sm font-semibold text-primary"
			>
				{$LL.editor.transcriptSegments()} <span class="text-secondary">{subtitles.length}</span>
			</h3>
			<ol class="min-h-40 space-y-3 overflow-y-auto p-4 md:min-h-0">
				{#each subtitles as subtitle, index (subtitle.id)}
					<li class="space-y-2 rounded-lg border border-color bg-primary p-3">
						<div class="flex items-center justify-between gap-3 text-xs text-thirdly">
							<span>{index + 1}</span>
							<span class="monospaced"
								>{new Duration(subtitle.startTime).getFormattedTime(false, true)} – {new Duration(
									subtitle.endTime
								).getFormattedTime(false, true)}</span
							>
						</div>
						<p
							dir="auto"
							class="whitespace-pre-wrap break-words text-sm leading-relaxed text-primary"
						>
							{subtitle.text}
						</p>
					</li>
				{/each}
			</ol>
		</section>
		<section class="space-y-5 overflow-y-auto p-5">
			<fieldset disabled={busy} class="space-y-5 disabled:opacity-60">
				<h3 class="text-sm font-semibold text-primary">{copy.preferences()}</h3>
				<label class="block space-y-1 text-sm text-secondary">
					<span>{$LL.editor.maxWordsPerSegment()}</span>
					<input type="number" min="1" max="50" step="1" bind:value={maxWords} class={inputClass} />
				</label>
				<label class="block space-y-1 text-sm text-secondary">
					<span>{copy.maxDuration()}</span>
					<input
						type="number"
						min="1"
						max="30"
						step="0.5"
						bind:value={maxDuration}
						class={inputClass}
					/>
				</label>
				<label class="block space-y-1 text-sm text-secondary">
					<span>{copy.additionalPreferences()}</span>
					<textarea
						rows="4"
						bind:value={additionalPreferences}
						class={inputClass}
						placeholder={copy.additionalPreferencesHint()}
					></textarea>
				</label>
				<button
					type="button"
					onclick={openTextAiSettings}
					class="cursor-pointer text-sm text-accent underline">{copy.textAiSettings()}</button
				>
				{#if !hasTextAiKey}<p class="text-xs text-thirdly">{copy.rearrangeKeyRequired()}</p>{/if}
			</fieldset>
			<p class="text-xs text-thirdly">{copy.rearrangeNotice()}</p>
			<button
				type="button"
				disabled={busy || !hasTextAiKey || !subtitles.length}
				onclick={rearrange}
				class="btn-accent w-full px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
			>
				{copy.rearrangeAction()}
			</button>
			{#if busy}
				<p role="status" class="text-sm text-secondary">{copy.rearranging()} ({progress}%)</p>
				<p class="text-xs text-thirdly">{copy.cancelHint()}</p>
				<button
					type="button"
					onclick={dismiss}
					class="w-full cursor-pointer rounded-lg border border-color px-3 py-2 text-sm text-primary"
					>{$LL.common.cancel()}</button
				>
			{/if}
			{#if result}
				<p role="status" class="text-sm text-secondary">
					{copy.rearrangeComplete()} ({result.count})
				</p>
				{#if result.skipped}<p class="text-sm text-amber-400">
						{copy.rearrangeSkipped()} ({result.skipped})
					</p>{/if}
			{/if}
			{#if errorMessage}<p role="alert" class="text-sm text-red-400">{errorMessage}</p>{/if}
		</section>
	</TranslationsEditorModalShell>
</div>
