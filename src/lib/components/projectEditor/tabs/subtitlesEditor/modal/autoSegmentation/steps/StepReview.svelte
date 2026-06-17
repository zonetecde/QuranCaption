<script lang="ts">
	import { getSharedWizard } from '../sharedWizard';
	import LL from '$lib/i18n/i18n-svelte';

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
						: $LL.editor.muaalemLocalLabel()
	);
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">{$LL.editor.reviewAndLaunch()}</h3>
		<p class="text-sm text-thirdly">{$LL.editor.reviewAndLaunchDesc()}</p>
	</div>

	<div class="rounded-xl border border-color p-4 space-y-2 text-sm">
		<div class="text-secondary">
			{$LL.editor.methodLabel()}: <span class="text-primary font-semibold">{versionLabel()}</span>
		</div>
		<div class="text-secondary">
			{$LL.editor.modelLabel()}:
			<span class="text-primary font-semibold">{wizard.selectedModel()}</span>
		</div>
		<div class="text-secondary">
			{$LL.editor.deviceLabel()}:
			<span class="text-primary font-semibold"
				>{wizard.selection.aiVersion === 'legacy_v1'
					? $LL.editor.automaticLabel()
					: wizard.selectedDevice()}</span
			>
		</div>
		<div class="text-secondary">
			{$LL.editor.audioSourceLabel()}:
			<span class="text-primary font-semibold">{wizard.audioLabel()}</span>
		</div>
		{#if wizard.selection.aiVersion === 'surah_splitter'}
			<div class="text-secondary">
				{$LL.editor.surahLabel()}:
				<span class="text-primary font-semibold"
					>{wizard.selection.surahSplitterSurah === null
						? $LL.editor.autoDetectLabel()
						: `Surah ${wizard.selection.surahSplitterSurah}`}</span
				>
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'muaalem_local'}
			<div class="text-secondary">
				{$LL.editor.muaalemMultipleSurahsLabel()}:
				<span class="text-primary font-semibold"
					>{wizard.selection.muaalemMultipleSurahs
						? $LL.editor.enabledLabel()
						: $LL.editor.disabledLabel()}</span
				>
			</div>
		{/if}
		<div class="text-secondary">
			{$LL.editor.wbwTimestampsLabel()}:
			<span class="text-primary font-semibold"
				>{!wizard.supportsWbwTimestamps()
					? $LL.editor.notAvailableLabel()
					: wizard.includeWbwTimestamps
						? $LL.editor.enabledLabel()
						: $LL.editor.disabledLabel()}</span
			>
		</div>
		<div class="text-secondary">
			{$LL.editor.presetTimingSummary()}:
			<span class="text-primary font-semibold"
				>{wizard.minSilenceMs}ms silence, {wizard.minSpeechMs}ms speech, {wizard.padMs}ms padding</span
			>
		</div>
		{#if wizard.selection.aiVersion === 'multi_v2_local' && !wizard.selection.hfToken.trim()}
			<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
			>
				{$LL.editor.tokenRequiredHint()}
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'muaalem_local'}
			<div
				class="rounded-lg border border-yellow-500/10 bg-yellow-500/2 px-3 py-2 text-xs text-yellow-300/90 mt-4"
			>
				{$LL.editor.muaalemReviewHint()}
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'surah_splitter'}
			<div
				class="rounded-lg border border-yellow-500/10 bg-yellow-500/2 px-3 py-2 text-xs text-yellow-300/90 mt-4"
			>
				{$LL.editor.surahSplitterReviewHint()}
			</div>
		{/if}
		{#if wizard.selection.aiVersion === 'legacy_v1'}
			<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
			>
				{$LL.editor.legacyV1ReviewHint()}
			</div>
		{/if}
		{#if !wizard.hasAudio()}
			<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
				{$LL.editor.noAudioDetectedWarning()}
			</div>
		{/if}
	</div>
</section>
