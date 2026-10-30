<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { getSharedWizard } from '../sharedWizard';

	let { isImport = false }: { isImport?: boolean } = $props();
	const wizard = getSharedWizard();
	const importCopy = $derived(
		$LL.editor as unknown as Record<
			'appendImportedSubtitles' | 'appendImportedSubtitlesDescription',
			() => string
		>
	);
</script>

<section class="space-y-5">
	<div class="space-y-2">
		<h3 class="text-xl font-semibold text-primary">{$LL.editor.existingSubtitlesQuestion()}</h3>
		<p class="text-sm text-secondary">{$LL.editor.existingSubtitlesSameVersesWarning()}</p>
	</div>

	<div class="grid gap-3 md:grid-cols-2">
		<button
			type="button"
			class="rounded-xl border p-4 text-start transition-colors"
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
			class="rounded-xl border p-4 text-start transition-colors"
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

		{#if isImport}
			<button
				type="button"
				class="rounded-xl border p-4 text-start transition-colors md:col-span-2"
				class:border-accent-primary={wizard.subtitleApplicationMode === 'append'}
				class:bg-accent={wizard.subtitleApplicationMode === 'append'}
				class:border-color={wizard.subtitleApplicationMode !== 'append'}
				onclick={() => wizard.setSubtitleApplicationMode('append')}
			>
				<div class="font-medium text-primary">{importCopy.appendImportedSubtitles()}</div>
				<div class="mt-1 text-xs text-thirdly">
					{importCopy.appendImportedSubtitlesDescription()}
				</div>
			</button>
		{/if}
	</div>
</section>
