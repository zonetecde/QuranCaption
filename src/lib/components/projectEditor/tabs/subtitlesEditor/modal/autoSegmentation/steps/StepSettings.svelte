<script lang="ts">
	import { SEGMENTATION_PRESETS } from '../constants';
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">Segmentation settings</h3>
		<p class="text-sm text-thirdly">
			Use presets first, then fine-tune timing and silence behavior.
		</p>
	</div>

	<div class="grid grid-cols-1 gap-2 xl:grid-cols-3">
		{#each SEGMENTATION_PRESETS as preset}
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
			>Min Silence: <span class="font-mono text-primary">{wizard.minSilenceMs}ms</span></label
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
		<label for="min-speech-range" class="block text-sm text-secondary"
			>Min Speech: <span class="font-mono text-primary">{wizard.minSpeechMs}ms</span></label
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
		<label for="pad-range" class="block text-sm text-secondary"
			>Padding: <span class="font-mono text-primary">{wizard.padMs}ms</span></label
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

	<div class="rounded-xl border border-color p-4 space-y-2">
		<label class="flex items-center gap-2 text-sm text-secondary"
			><input
				type="checkbox"
				checked={wizard.fillBySilence}
				onchange={(e) => wizard.setFillBySilence((e.currentTarget as HTMLInputElement).checked)}
				class="accent-accent-primary"
			/> Fill gaps with silence clips</label
		>
		{#if wizard.fillBySilence}
			<div class="flex items-center gap-2 text-sm text-secondary">
				<label for="extend-before-silence-ms" class="flex items-center gap-2"
					><input
						type="checkbox"
						checked={wizard.extendBeforeSilence}
						onchange={(e) =>
							wizard.setExtendBeforeSilence((e.currentTarget as HTMLInputElement).checked)}
						class="accent-accent-primary"
					/> Extend subtitle before silence by</label
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
				This extends the segment right before a silence block by {wizard.extendBeforeSilenceMs} ms.
			</p>
		{/if}
	</div>
</section>
