<script lang="ts">
	import { SEGMENTATION_PRESETS } from '../constants';
	import { getSharedWizard } from '../sharedWizard';
	import LL from '$lib/i18n/i18n-svelte';
	import StepExistingSubtitles from './StepExistingSubtitles.svelte';

	const wizard = getSharedWizard();
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">
			{wizard.selection.aiVersion === 'multi_v2'
				? $LL.editor.timelineBehavior()
				: $LL.editor.adjustSegmentation()}
		</h3>
		<p class="text-sm text-thirdly">
			{wizard.selection.aiVersion === 'multi_v2'
				? $LL.editor.timelineBehaviorDesc()
				: $LL.editor.adjustSegmentationDesc()}
		</p>
	</div>

	{#if wizard.selection.aiVersion !== 'multi_v2'}
		<div class="grid grid-cols-1 gap-2 xl:grid-cols-3">
			{#each SEGMENTATION_PRESETS as preset (preset.id)}
				<button
					type="button"
					class="rounded-lg border px-3 py-2 text-xs"
					class:border-accent-primary={wizard.isPresetActive(preset)}
					class:bg-accent={wizard.isPresetActive(preset)}
					class:border-color={!wizard.isPresetActive(preset)}
					onclick={() => wizard.applyPreset(preset)}>{preset.label}</button
				>
			{/each}
		</div>

		<div class="space-y-3 rounded-xl border border-color p-4">
			<label for="min-silence-range" class="block text-sm text-secondary"
				>{$LL.editor.minSilenceLabel()}:
				<span class="font-mono text-primary">{wizard.minSilenceMs}ms</span></label
			>
			<input
				id="min-silence-range"
				type="range"
				min="50"
				max="1200"
				step="25"
				value={wizard.minSilenceMs}
				oninput={(e) => wizard.setMinSilence(Number((e.currentTarget as HTMLInputElement).value))}
				class="w-full accent-accent-primary"
			/>
			{#if wizard.selection.aiVersion !== 'quran_word_timing'}
				<label for="min-speech-range" class="block text-sm text-secondary"
					>{$LL.editor.minSpeechLabel()}:
					<span class="font-mono text-primary">{wizard.minSpeechMs}ms</span></label
				>
				<input
					id="min-speech-range"
					type="range"
					min="500"
					max="3000"
					step="50"
					value={wizard.minSpeechMs}
					oninput={(e) => wizard.setMinSpeech(Number((e.currentTarget as HTMLInputElement).value))}
					class="w-full accent-accent-primary"
				/>
			{/if}
			<label for="pad-range" class="block text-sm text-secondary"
				>{$LL.editor.paddingLabel()}:
				<span class="font-mono text-primary">{wizard.padMs}ms</span></label
			>
			<input
				id="pad-range"
				type="range"
				min="0"
				max="500"
				step="10"
				value={wizard.padMs}
				oninput={(e) => wizard.setPad(Number((e.currentTarget as HTMLInputElement).value))}
				class="w-full accent-accent-primary"
			/>
		</div>
	{/if}

	<div class="rounded-xl border border-color p-4 space-y-2">
		<div class="mb-3 space-y-2 border-b border-color pb-3">
			<label class="flex items-center gap-2 text-sm text-secondary"
				><input
					type="checkbox"
					checked={wizard.supportsWbwTimestamps() ? wizard.includeWbwTimestamps : false}
					onchange={(e) =>
						wizard.setIncludeWbwTimestamps((e.currentTarget as HTMLInputElement).checked)}
					disabled={!wizard.supportsWbwTimestamps()}
					class="accent-accent-primary disabled:cursor-not-allowed disabled:opacity-50"
				/>
				{$LL.editor.includeWbwTimestamps()}</label
			>
			<p class="text-xs text-thirdly">
				{$LL.editor.wbwTimestampsDescription()}
			</p>
		</div>

		{#if wizard.selection.aiVersion === 'multi_v2'}
			<div class="mb-3 space-y-2 border-b border-color pb-3">
				<div class="text-xs uppercase text-thirdly">{$LL.editor.segmentBoundaries()}</div>
				<div class="grid grid-cols-2 gap-3">
					<label class="space-y-1 text-xs text-thirdly">
						<span>{$LL.editor.startEarlier()}</span>
						<div class="flex items-center gap-2">
							<input
								type="number"
								min="0"
								max="1000"
								step="10"
								value={wizard.padLeftMs}
								oninput={(event) => wizard.setPadLeft(Number(event.currentTarget.value))}
								class="min-w-0 flex-1 rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
							/>
							<span>ms</span>
						</div>
					</label>
					<label class="space-y-1 text-xs text-thirdly">
						<span>{$LL.editor.endLater()}</span>
						<div class="flex items-center gap-2">
							<input
								type="number"
								min="0"
								max="1000"
								step="10"
								value={wizard.padRightMs}
								oninput={(event) => wizard.setPadRight(Number(event.currentTarget.value))}
								class="min-w-0 flex-1 rounded-lg border border-color bg-bg-primary px-3 py-2 text-sm text-primary"
							/>
							<span>ms</span>
						</div>
					</label>
				</div>
			</div>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<button
					type="button"
					class="rounded-lg border p-3 text-left text-sm"
					class:border-accent-primary={wizard.fillBySilence}
					class:border-color={!wizard.fillBySilence}
					onclick={() => wizard.setFillBySilence(true)}>{$LL.editor.keepSilentGaps()}</button
				>
				<button
					type="button"
					class="rounded-lg border p-3 text-left text-sm"
					class:border-accent-primary={!wizard.fillBySilence}
					class:border-color={wizard.fillBySilence}
					onclick={() => wizard.setFillBySilence(false)}>{$LL.editor.keepSubtitlesVisible()}</button
				>
			</div>
		{:else}
			<label class="flex items-center gap-2 text-sm text-secondary"
				><input
					type="checkbox"
					checked={wizard.fillBySilence}
					onchange={(e) => wizard.setFillBySilence((e.currentTarget as HTMLInputElement).checked)}
					class="accent-accent-primary"
				/>
				{$LL.editor.fillGapsWithSilence()}</label
			>
		{/if}
		{#if wizard.fillBySilence && wizard.selection.aiVersion !== 'multi_v2'}
			<div class="flex items-center gap-2 text-sm text-secondary">
				<label for="extend-before-silence-ms" class="flex items-center gap-2"
					><input
						type="checkbox"
						checked={wizard.extendBeforeSilence}
						onchange={(e) =>
							wizard.setExtendBeforeSilence((e.currentTarget as HTMLInputElement).checked)}
						class="accent-accent-primary"
					/>
					{$LL.editor.extendSubtitleBeforeSilence()}</label
				>
				<input
					id="extend-before-silence-ms"
					type="number"
					min="0"
					max="2000"
					step="10"
					value={wizard.extendBeforeSilenceMs}
					oninput={(e) =>
						wizard.setExtendBeforeSilenceMs(Number((e.currentTarget as HTMLInputElement).value))}
					disabled={!wizard.extendBeforeSilence}
					class="w-24 rounded border border-color bg-primary px-2 py-1 text-xs text-primary"
				/>
				<span>ms</span>
			</div>
			<p class="text-xs text-thirdly">
				{$LL.editor.extendBeforeSilenceHint({ ms: wizard.extendBeforeSilenceMs })}
			</p>
		{/if}
	</div>

	{#if wizard.selection.aiVersion === 'multi_v2' && wizard.showExistingSubtitlesStep}
		<StepExistingSubtitles />
	{/if}
</section>
