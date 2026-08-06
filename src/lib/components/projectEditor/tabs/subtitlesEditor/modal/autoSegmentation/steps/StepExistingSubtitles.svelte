<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
</script>

<section class="space-y-5">
	<div class="space-y-2">
		<h3 class="text-xl font-semibold text-primary">{$LL.editor.existingSubtitlesQuestion()}</h3>
		<p class="text-sm text-secondary">{$LL.editor.existingSubtitlesSameVersesWarning()}</p>
	</div>

	<div class="grid gap-3 md:grid-cols-2">
		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.subtitleApplicationMode === 'replace'}
			class:bg-accent={wizard.subtitleApplicationMode === 'replace'}
			class:border-color={wizard.subtitleApplicationMode !== 'replace'}
			onclick={() => wizard.setSubtitleApplicationMode('replace')}
		>
			<div class="font-medium text-primary">{$LL.editor.replaceCurrentSubtitles()}</div>
			<div class="mt-1 text-xs text-thirdly">
				{$LL.editor.replaceCurrentSubtitlesDescription()}
			</div>
		</button>

		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.subtitleApplicationMode === 'align'}
			class:bg-accent={wizard.subtitleApplicationMode === 'align'}
			class:border-color={wizard.subtitleApplicationMode !== 'align'}
			onclick={() => wizard.setSubtitleApplicationMode('align')}
		>
			<div class="font-medium text-primary">{$LL.editor.alignCurrentSubtitles()}</div>
			<div class="mt-1 text-xs text-thirdly">
				{$LL.editor.alignCurrentSubtitlesDescription()}
			</div>
		</button>
	</div>
</section>
