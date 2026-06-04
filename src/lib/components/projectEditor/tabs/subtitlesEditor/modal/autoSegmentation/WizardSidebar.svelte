<script lang="ts">
	import { getSharedWizard } from './sharedWizard';
	import LL from '$lib/i18n/i18n-svelte';

	const wizard = getSharedWizard();
	const chipTone = $derived(() =>
		wizard.hasAudio() ? 'text-green-300 bg-green-500/15' : 'text-red-300 bg-red-500/15'
	);
	const versionLabel = $derived(() =>
		wizard.selection.aiVersion === 'legacy_v1'
			? 'Legacy V1'
			: wizard.selection.aiVersion === 'multi_v2'
				? 'Quranic Universal Aligner'
				: wizard.selection.aiVersion === 'multi_v2_local'
					? 'Private Local Quranic Universal Aligner'
					: 'Muaalem Local'
	);
</script>

<aside class="w-[320px] min-w-[280px] border-r border-color bg-primary/80 p-5 space-y-4">
	<div class="space-y-1">
		<div class="text-xs uppercase tracking-wide text-thirdly">{$LL.editor.aiSegmentationHeading()}</div>
		<h2 class="text-xl font-semibold text-primary">{$LL.editor.selectRuntime()}</h2>
		<p class="text-xs text-thirdly">{$LL.editor.runtimeDescription()}</p>
	</div>

	<div class="rounded-xl border border-color bg-accent/70 p-3 space-y-2">
		<div class={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-[11px] ${chipTone()}`}>
			<span class="material-icons text-sm">{wizard.hasAudio() ? 'check_circle' : 'warning'}</span>
			{wizard.hasAudio() ? $LL.editor.audioDetected() : $LL.editor.noAudioClip()}
		</div>
		<div class="text-xs text-secondary break-words">{wizard.audioLabel()}</div>
		<div class="text-[11px] text-thirdly">
			{$LL.editor.selectModel()}: {versionLabel()}
		</div>
	</div>

	<nav class="space-y-2">
		{#each wizard.steps as step, index (index)}
			<button
				type="button"
				class="w-full rounded-xl border px-3 py-2 text-left transition-colors"
				class:border-accent-primary={wizard.currentStep === index}
				class:bg-accent={wizard.currentStep === index}
				class:border-color={wizard.currentStep !== index}
				class:opacity-80={wizard.currentStep !== index}
				onclick={() => wizard.goToStep(index)}
			>
				<div class="flex items-center gap-2">
					<span class="material-icons text-accent-primary text-[20px]">{step.icon}</span>
					<div class="text-sm text-primary font-medium">{step.title}</div>
				</div>
				<div class="pl-7 text-[11px] text-thirdly">{step.subtitle}</div>
			</button>
		{/each}
	</nav>
</aside>
