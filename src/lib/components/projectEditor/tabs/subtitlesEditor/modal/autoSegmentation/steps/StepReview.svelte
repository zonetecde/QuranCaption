<script lang="ts">
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
	const versionLabel = $derived(() =>
		wizard.selection.aiVersion === 'legacy_v1'
			? 'Legacy V1'
			: wizard.selection.aiVersion === 'multi_v2'
				? 'Quranic Universal Aligner'
				: wizard.selection.aiVersion === 'multi_v2_local'
					? 'Private Local Quranic Universal Aligner'
					: wizard.selection.aiVersion === 'surah_splitter'
						? 'Surah Splitter Local'
						: 'Muaalem Local'
	);
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">5. Review and launch</h3>
		<p class="text-sm text-thirdly">Check your configuration before generating subtitles.</p>
	</div>

	<div class="rounded-xl border border-color p-4 space-y-2 text-sm">
		<div class="text-secondary">
			Method: <span class="text-primary font-semibold">{versionLabel()}</span>
		</div>
		<div class="text-secondary">
			Model: <span class="text-primary font-semibold">{wizard.selectedModel()}</span>
		</div>
		<div class="text-secondary">
			Device:
			<span class="text-primary font-semibold"
				>{wizard.selection.aiVersion === 'legacy_v1' ? 'Automatic' : wizard.selectedDevice()}</span
			>
		</div>
		<div class="text-secondary">
			Audio source: <span class="text-primary font-semibold">{wizard.audioLabel()}</span>
		</div>
		{#if wizard.selection.aiVersion === 'surah_splitter'}
			<div class="text-secondary">
				Surah:
				<span class="text-primary font-semibold"
					>{wizard.selection.surahSplitterSurah === null
						? 'Auto-detect'
						: `Surah ${wizard.selection.surahSplitterSurah}`}</span
				>
			</div>
		{/if}
		<div class="text-secondary">
			Word-by-word timestamps:
			<span class="text-primary font-semibold"
				>{!wizard.supportsWbwTimestamps()
					? 'Not available'
					: wizard.includeWbwTimestamps
						? 'Enabled'
						: 'Disabled'}</span
			>
		</div>
		<div class="text-secondary">
			Preset / timing summary:
			<span class="text-primary font-semibold"
				>{wizard.minSilenceMs}ms silence, {wizard.minSpeechMs}ms speech, {wizard.padMs}ms padding</span
			>
		</div>
		{#if wizard.selection.aiVersion === 'multi_v2_local' && !wizard.selection.hfToken.trim()}
			<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
			>
				This method requires a valid Hugging Face token before it can run.
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'muaalem_local'}
			<div
				class="rounded-lg border border-yellow-500/10 bg-yellow-500/2 px-3 py-2 text-xs text-yellow-300/90 mt-4"
			>
				This method is fully local and simpler to install, but usually less effective than the
				official Quranic Universal Aligner pipeline.
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'surah_splitter'}
			<div
				class="rounded-lg border border-yellow-500/10 bg-yellow-500/2 px-3 py-2 text-xs text-yellow-300/90 mt-4"
			>
				Auto-detection is available, but specifying the surah improves precision.
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'legacy_v1'}
			<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
			>
				Legacy V1 is an older fallback pipeline with lower alignment quality.
			</div>
		{/if}
		{#if !wizard.hasAudio()}
			<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
				No audio clip was detected in the current timeline.
			</div>
		{/if}
	</div>
</section>
