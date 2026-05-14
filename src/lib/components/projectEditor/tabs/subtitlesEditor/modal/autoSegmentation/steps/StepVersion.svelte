<script lang="ts">
	import { onMount } from 'svelte';
	import { getSharedWizard } from '../sharedWizard';
	import {
		fetchQuranMultiAlignerChangelog,
		type HuggingFaceChangelogSection
	} from '$lib/services/HuggingFaceChangelog';

	const wizard = getSharedWizard();
	let changelogSections = $state<HuggingFaceChangelogSection[]>([]);
	let isLoadingChangelog = $state(true);
	let changelogError = $state<string | null>(null);
	let {
		activeView = $bindable('wizard')
	}: {
		activeView: 'wizard' | 'import';
	} = $props();

	onMount(async () => {
		try {
			changelogSections = await fetchQuranMultiAlignerChangelog();
		} catch (error) {
			console.error('Failed to load Quran Multi-Aligner changelog:', error);
			changelogError = 'Unable to load the latest changelog right now.';
		} finally {
			isLoadingChangelog = false;
		}
	});
</script>

<section class="flex flex-col gap-4 xl:flex-1">
	<div>
		<h3 class="text-lg font-semibold text-primary">1. Choose a method</h3>
		<p class="text-sm text-thirdly">
			Pick the simplest method for your situation. You can still change advanced options later.
		</p>
	</div>

	<div class="grid grid-cols-1 gap-3 xl:flex-1 xl:grid-cols-2">
		<button
			type="button"
			class="rounded-xl border bg-gradient-to-br from-accent/80 to-bg-accent p-4 text-left shadow-sm transition-colors xl:col-span-2"
			class:border-accent-primary={wizard.selection.aiVersion === 'multi_v2'}
			class:border-color={wizard.selection.aiVersion !== 'multi_v2'}
			class:bg-accent={wizard.selection.aiVersion === 'multi_v2'}
			onclick={() => wizard.onVersionChange('multi_v2')}
		>
			<div class="mb-3 flex items-start justify-between gap-3">
				<div class="flex items-center gap-2 text-primary">
					<span class="material-icons">auto_awesome</span>Quranic Universal Aligner
				</div>
				<span
					class="inline-flex items-center rounded-full border border-accent-primary bg-accent-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--bg-primary)]"
				>
					Recommended
				</span>
			</div>
			<p class="text-sm font-medium text-primary">Best overall quality and easiest setup</p>
			<p class="mt-2 text-sm text-thirdly">
				Uses the official Quranic Universal Aligner remotely. Recommended for most users.
			</p>
		</button>

		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.selection.aiVersion === 'muaalem_local'}
			class:bg-accent={wizard.selection.aiVersion === 'muaalem_local'}
			class:border-color={wizard.selection.aiVersion !== 'muaalem_local'}
			onclick={() => wizard.onVersionChange('muaalem_local')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">offline_bolt</span>Muaalem Local
			</div>
			<p class="text-sm font-medium text-primary">Fully local, no token required</p>
			<p class="mt-3 text-xs text-thirdly">
				Runs entirely on your machine with the Muaalem local pipeline. It uses Quran-specific
				segmentation and matching, but is usually less effective than the official Quranic
				Universal Aligner.
			</p>
			<div
				class="mt-3 inline-flex items-center rounded-full border border-color px-2 py-1 text-[11px] text-thirdly"
			>
				Offline
			</div>
		</button>

		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.selection.aiVersion === 'multi_v2_local'}
			class:bg-accent={wizard.selection.aiVersion === 'multi_v2_local'}
			class:border-color={wizard.selection.aiVersion !== 'multi_v2_local'}
			onclick={() => wizard.onVersionChange('multi_v2_local')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">computer</span>Private Local Quranic Universal Aligner
			</div>
			<p class="text-sm font-medium text-primary">Best local accuracy</p>
			<p class="mt-3 text-xs text-thirdly">
				Runs on your machine with the private local Quranic Universal Aligner stack. Requires Python
				setup and a Hugging Face token.
			</p>
			<div
				class="mt-3 inline-flex items-center rounded-full border border-color px-2 py-1 text-[11px] text-thirdly"
			>
				Advanced
			</div>
		</button>

		<p
			class="text-xs underline text-center text-secondary mt-3 cursor-pointer h-fit xl:col-span-2"
			onclick={() => (activeView = 'import')}
		>
			Import Hugging Face JSON
		</p>
	</div>

	<section class="rounded-xl border border-[var(--border-color)]/60 bg-accent/20 p-4 xl:mt-auto">
		<details>
			<summary class="flex cursor-pointer items-center gap-2 text-primary">
				<span class="material-icons">history</span>
				<h4 class="text-sm font-semibold">
					Latest changelog <span class="text-thirdly">(Quranic Universal Aligner)</span>
				</h4>
			</summary>

			<div class="mt-3">
				{#if isLoadingChangelog}
					<p class="text-sm text-thirdly">Loading latest Quran Multi-Aligner updates...</p>
				{:else if changelogError}
					<p class="text-sm text-thirdly">{changelogError}</p>
				{:else if changelogSections.length === 0}
					<p class="text-sm text-thirdly">No recent changelog entries were found.</p>
				{:else}
					<div class="space-y-3">
						{#each changelogSections as section (section.title)}
							<div class="rounded-lg border border-[var(--border-color)]/50 bg-accent/35 p-3">
								<p class="text-sm font-medium text-primary">{section.title}</p>
								<ul class="mt-2 space-y-2 text-sm text-thirdly">
									{#each section.items as item}
										<li class="flex gap-2">
											<span class="mt-[2px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary/70"
											></span>
											<span>{item}</span>
										</li>
									{/each}
								</ul>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</details>
	</section>
</section>
