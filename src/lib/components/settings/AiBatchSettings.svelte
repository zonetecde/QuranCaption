<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		ANALYSIS_BATCH_SIZES,
		TRANSLATION_BATCH_SIZES,
		getAiBatchLimits,
		type AiBatchCopy
	} from '$lib/services/AiBatchSettings';

	const copy = $derived(($LL.settings as unknown as { aiBatches: AiBatchCopy }).aiBatches);
	const settings = $derived(globalState.settings!.aiTranslationSettings);
	const controls = $derived([
		{
			key: 'analysisBatchSize',
			sizes: ANALYSIS_BATCH_SIZES,
			title: copy.analysisTitle(),
			description: copy.analysisDescription(),
			unit: copy.subtitlesUnit(),
			value: getAiBatchLimits(settings).items
		},
		{
			key: 'projectTranslationBatchWords',
			sizes: TRANSLATION_BATCH_SIZES,
			title: copy.translationTitle(),
			description: copy.translationDescription(),
			unit: copy.wordsUnit(),
			value: getAiBatchLimits(settings, true).words
		}
	] as const);
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-lg font-medium text-primary">{copy.title()}</h3>
		<p class="mt-1 text-sm text-thirdly">{copy.description()}</p>
	</div>
	{#each controls as control (control.key)}
		<section class="space-y-4 rounded-xl border border-color bg-primary p-4">
			<div>
				<label for={control.key} class="text-sm font-medium text-primary">{control.title}</label>
				<p class="mt-1 text-xs text-thirdly">{control.description}</p>
			</div>
			<p class="text-sm text-accent"><strong>{control.value}</strong> {control.unit}</p>
			<input
				id={control.key}
				type="range"
				dir="ltr"
				min="0"
				max={control.sizes.length - 1}
				step="1"
				value={Math.max(
					0,
					control.sizes.findIndex((size) => size <= control.value)
				)}
				aria-valuetext={`${control.value} ${control.unit}`}
				class="w-full accent-accent-primary"
				oninput={(event) =>
					(settings[control.key] = control.sizes[Number(event.currentTarget.value)])}
				onchange={() => Settings.save()}
			/>
			<div class="flex justify-between gap-4 text-xs text-thirdly" dir="ltr">
				<span dir="auto">{copy.fewer()}</span><span dir="auto">{copy.more()}</span>
			</div>
		</section>
	{/each}
	<p class="text-xs leading-relaxed text-thirdly">{copy.note()}</p>
</div>
