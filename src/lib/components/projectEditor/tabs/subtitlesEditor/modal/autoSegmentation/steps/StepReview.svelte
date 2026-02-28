<script lang="ts">
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">Review and run</h3>
		<p class="text-sm text-thirdly">
			Confirm your configuration before launching auto-segmentation.
		</p>
	</div>

	<div class="rounded-xl border border-color p-4 space-y-2 text-sm">
		<div class="text-secondary">
			Version: <span class="text-primary font-semibold"
				>{wizard.selection.aiVersion === 'legacy_v1' ? 'Legacy V1' : 'Multi-Aligner V2'}</span
			>
		</div>
		<div class="text-secondary">
			Runtime: <span class="text-primary font-semibold">{wizard.runtimeLabel()}</span>
		</div>
		{#if wizard.selection.runtime !== 'hf_json'}
			<div class="text-secondary">
				Model: <span class="text-primary font-semibold">{wizard.selectedModel()}</span>
			</div>
			<div class="text-secondary">
				Device: <span class="text-primary font-semibold">{wizard.selectedDevice()}</span>
			</div>
		{:else}
			<div class="text-secondary">
				Import source: <span class="text-primary font-semibold"
					>{wizard.importedJsonFileName || 'Pasted JSON content'}</span
				>
			</div>
			<div class="text-secondary">
				Parsed segments: <span class="text-primary font-semibold">{wizard.importedJsonSegmentCount}</span>
			</div>
		{/if}
		<div class="text-secondary">
			Audio: <span class="text-primary font-semibold">{wizard.audioLabel()}</span>
		</div>
		{#if
			wizard.selection.aiVersion === 'multi_v2' &&
			wizard.selection.mode === 'local' &&
			!wizard.selection.hfToken.trim()}
			<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
			>
				Local V2 uses private HF models (`hetchyy/r15_95m`, `hetchyy/r7`) and may require an
				authorized token. If the token is missing, segmentation will stop in Local mode.
			</div>
		{/if}
		{#if !wizard.hasAudio()}
			<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
				No audio clip was detected in the current timeline.
			</div>
		{/if}
	</div>
</section>
