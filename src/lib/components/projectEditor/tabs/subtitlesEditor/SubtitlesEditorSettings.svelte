<script lang="ts">
	import { AssetClip, SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { enterManualWordByWordEdit, exitManualWordByWordEdit } from '$lib/services/WbwHelper';
	import AutoSegmentationModal from './modal/AutoSegmentationModal.svelte';
	import SegmentsToReview from './SegmentsToReview.svelte';
	import MarkLongSubtitles from './MarkLongSubtitles.svelte';
	import MarkMissingWbwTimestamps from './MarkMissingWbwTimestamps.svelte';
	import SplitLongSubtitles from './SplitLongSubtitles.svelte';

	import { fade } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let autoSegmentationModalVisible = $state(false);

	/**
	 * Ouvre le mode d'edition WBW manuel pour le sous-titre courant.
	 *
	 * @returns {Promise<void>}
	 */
	async function openManualWbwEditMode(): Promise<void> {
		const editSubtitle = globalState.getSubtitlesEditorState.editSubtitle;
		if (!(editSubtitle instanceof SubtitleClip)) return;

		const success = await enterManualWordByWordEdit(editSubtitle);
		if (!success) {
			toast.error(get(LL).editor.cannotEnterWordEditMode());
		}
	}
</script>

<div
	class="bg-secondary h-full min-h-0 overflow-y-auto border border-color rounded-lg py-6 px-3 space-y-6 border-r-0 overflow-x-hidden"
>
	<!-- Header with icon -->
	<div class="flex gap-x-2 items-center justify-center">
		<span class="material-icons text-accent text-xl">subtitles</span>
		<h2 class="text-xl font-bold text-primary">{$LL.editor.subtitlesEditor()}</h2>
	</div>

	{#if globalState.getSubtitlesEditorState.editSubtitle}
		<!-- Subtitle editing mode -->
		<div class="space-y-2">
			<div
				class="rounded-xl border border-[var(--border-color)]/60 bg-gradient-to-br from-secondary to-secondary/60 backdrop-blur-sm p-2 shadow-inner"
			>
				<div class="flex items-start gap-3">
					<div class="xl:space-y-1">
						<h3 class="text-lg font-semibold text-primary tracking-wide flex items-center gap-2">
							{$LL.editor.editingSubtitle()}
							<span
								class="px-2 py-0.5 text-[10px] uppercase rounded-full bg-accent-primary/15 text-accent-primary border border-accent-primary/30"
								>{$LL.editor.editingActive()}</span
							>
						</h3>
						<p class="text-xs leading-relaxed text-secondary">
							{$LL.editor.editingHelpText()}
						</p>
					</div>
				</div>
			</div>

			{#if globalState.getSubtitlesEditorState.editSubtitle instanceof SubtitleClip}
				<div
					class="rounded-lg border border-[var(--border-color)]/60 bg-secondary/40 p-2 space-y-3"
				>
					<p class="text-sm font-semibold text-primary">{$LL.editor.wordByWordEdit()}</p>

					<div class="flex items-center justify-between gap-2 -mt-2">
						<div>
							<p class="text-[11px] text-secondary">
								{$LL.editor.wbwManualDescription()}
							</p>
						</div>

						{#if globalState.shared.wbwEdit.active}
							<button
								class="flex items-center gap-2 px-3 py-2 rounded-md border border-yellow-400/40 text-yellow-200 text-xs hover:bg-yellow-400/10 transition cursor-pointer"
								onclick={() => exitManualWordByWordEdit()}
							>
								<span class="material-icons text-base">close</span>
								{$LL.editor.exit()}
							</button>
						{:else}
							<button
								class="flex items-center gap-2 px-3 py-2 rounded-md border border-yellow-400/30 text-yellow-200 text-xs hover:bg-yellow-400/10 transition cursor-pointer"
								onclick={openManualWbwEditMode}
							>
								<span class="material-icons text-base">timeline</span>
								{$LL.editor.editWbw()}
							</button>
						{/if}
					</div>
				</div>
			{/if}

			{#if globalState.shared.wbwEdit.active}
				<!-- Playback Speed Section -->
				<div class="space-y-3 my-5">
					<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.wbwPlaybackSpeed()}</h3>
					<div class="flex items-center justify-center gap-1 2xl:gap-2">
						{#each [0.25, 0.5, 0.75, 1, 1.25] as speed (speed)}
							<button
								class="px-2 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer hover:scale-105 border {globalState
									.getSubtitlesEditorState.wbwPlaybackSpeed === speed
									? 'bg-accent-primary text-black border-transparent shadow-lg shadow-blue-500/25'
									: 'bg-secondary text-secondary border-color hover:bg-accent hover:text-primary hover:border-[var(--accent-primary)]'}"
								onclick={() => {
									globalState.getSubtitlesEditorState.wbwPlaybackSpeed = speed;
								}}
							>
								{speed}x
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Playback Speed Section -->
		<div class="space-y-3">
			<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.playbackSpeed()}</h3>
			<div class="flex items-center justify-center gap-1 2xl:gap-2">
				{#each [0.75, 1, 1.5, 1.75, 2] as speed (speed)}
					<button
						class="px-2 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer hover:scale-105 border {globalState
							.currentProject!.projectEditorState.subtitlesEditor.playbackSpeed === speed
							? 'bg-accent-primary text-black border-transparent shadow-lg shadow-blue-500/25'
							: 'bg-secondary text-secondary border-color hover:bg-accent hover:text-primary hover:border-[var(--accent-primary)]'}"
						onclick={() => {
							globalState.getSubtitlesEditorState.playbackSpeed = speed;
						}}
					>
						{speed}x
					</button>
				{/each}
			</div>
		</div>

		<!-- Options Section -->
		<div class="space-y-4">
			<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.displayOptions()}</h3>

			<div class="bg-accent rounded-lg p-4 space-y-4">
				<div class="flex items-center justify-between">
					<label class="text-sm font-medium text-primary cursor-pointer" for="showWordTranslation">
						{$LL.editor.showWordTranslation()}
					</label>
					<input
						id="showWordTranslation"
						type="checkbox"
						bind:checked={globalState.getSubtitlesEditorState.showWordTranslation}
						class="w-5 h-5"
					/>
				</div>

				<div class="flex items-center justify-between">
					<label
						class="text-sm font-medium text-primary cursor-pointer"
						for="showWordTransliteration"
					>
						{$LL.editor.showWordTransliteration()}
					</label>
					<input
						id="showWordTransliteration"
						type="checkbox"
						bind:checked={globalState.getSubtitlesEditorState.showWordTransliteration}
						class="w-5 h-5"
					/>
				</div>
			</div>
		</div>

		<!-- Progress Section -->
		<div class="space-y-3">
			<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.captionProgress()}</h3>
			<div class="bg-accent rounded-lg p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-sm text-secondary">{$LL.editor.completion()}</span>
					<span class="text-sm font-bold text-accent">
						{globalState.currentProject!.detail.percentageCaptioned}%
					</span>
				</div>
				<div class="w-full bg-secondary rounded-full h-3 relative overflow-hidden">
					<div
						class="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-secondary)] h-full rounded-full
					       transition-all duration-500 ease-out relative"
						style="width: {globalState.currentProject!.detail.percentageCaptioned}%"
					>
						<div class="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
					</div>
				</div>
			</div>
		</div>

		<div class="space-y-4">
			<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.aiAssistedSegmentation()}</h3>
			<div class="bg-accent rounded-lg p-4 space-y-3">
				<button
					class="btn-accent w-full px-3 py-2 rounded-md text-xs flex items-center justify-center gap-2"
					type="button"
					title={$LL.editor.autoSegmentButton()}
					onclick={() => (autoSegmentationModalVisible = true)}
				>
					<span class="material-icons text-base">auto_awesome</span>
					{$LL.editor.autoSegment()}
				</button>
			</div>
		</div>

		{#if (globalState.getAudioTrack?.clips || []).some((c) => c instanceof AssetClip && (globalState.currentProject?.content.getAssetById(c.assetId)?.metadata?.nativeTiming || globalState.currentProject?.content.getAssetById(c.assetId)?.metadata?.mp3Quran))}
			<div class="space-y-4">
				<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.nativeTiming()}</h3>
				<div class="bg-accent rounded-lg p-4 space-y-3">
					<button
						class="w-full px-3 py-2 rounded-md bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-[var(--accent-primary)]/20 transition cursor-pointer"
						type="button"
						onclick={async () => {
							const { runNativeSegmentation } = await import('$lib/services/AutoSegmentation');
							await runNativeSegmentation();
						}}
					>
						{$LL.editor.loadSubtitlesNativeTiming()}
					</button>
				</div>
			</div>
		{/if}

		<div class="space-y-3">
			<SegmentsToReview />
			<MarkLongSubtitles />
			<MarkMissingWbwTimestamps />
			<SplitLongSubtitles />
		</div>
	{/if}
</div>

{#if autoSegmentationModalVisible}
	<div class="modal-wrapper" transition:fade>
		<AutoSegmentationModal close={() => (autoSegmentationModalVisible = false)} />
	</div>
{/if}

<style>
	.animate-pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}
</style>
