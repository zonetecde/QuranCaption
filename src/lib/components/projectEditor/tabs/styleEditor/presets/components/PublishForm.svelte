<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { closePublishForm, publishPreset } from '../actions/publishActions';
	import { getClipLabel, getCustomClipsForUI, setsEqual } from '../actions/presetUtils';
	import PublishPreview from './PublishPreview.svelte';

	let publishName = $derived(globalState.presetLibrary.publishName);
	let publishAuthorName = $derived(globalState.presetLibrary.publishAuthorName);
	let publishDescription = $derived(globalState.presetLibrary.publishDescription);
	let publishTags = $derived(globalState.presetLibrary.publishTags);
	let publishPreviewBlob = $derived(globalState.presetLibrary.publishPreviewBlob);
	let publishError = $derived(globalState.presetLibrary.publishError);
	let isGeneratingPreview = $derived(globalState.presetLibrary.isGeneratingPreview);
	let isPublishing = $derived(globalState.presetLibrary.isPublishing);
	let includedCustomClipIds = $derived(globalState.presetLibrary.includedCustomClipIds);
	let lastCapturedInclusion = $derived(globalState.presetLibrary.lastCapturedInclusion);

	let inclusionChanged = $derived(
		() => lastCapturedInclusion !== null && !setsEqual(lastCapturedInclusion, includedCustomClipIds)
	);

	let canPublish = $derived(
		() =>
			publishName.trim().length > 0 &&
			publishAuthorName.trim().length > 0 &&
			publishPreviewBlob !== null &&
			!isGeneratingPreview &&
			!isPublishing &&
			!inclusionChanged()
	);

	/** Active/désactive un clip custom dans la sélection d'inclusion. */
	function toggleCustomClip(id: number, included: boolean): void {
		const state = globalState.presetLibrary;
		const next = new Set(state.includedCustomClipIds);
		if (included) {
			next.add(id);
		} else {
			next.delete(id);
		}
		state.includedCustomClipIds = next;
	}
</script>

<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
	<section class="space-y-4">
		<PublishPreview />

		<div class="space-y-3">
			<label class="block space-y-1.5">
				<span class="text-xs font-medium text-secondary">Name</span>
				<input
					bind:value={globalState.presetLibrary.publishName}
					class="h-9 w-full rounded-md border border-color bg-primary px-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
					type="text"
					maxlength="120"
					placeholder="Clean Quran style"
				/>
			</label>
			<label class="block space-y-1.5">
				<span class="text-xs font-medium text-secondary">Author</span>
				<input
					bind:value={globalState.presetLibrary.publishAuthorName}
					class="h-9 w-full rounded-md border border-color bg-primary px-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
					type="text"
					maxlength="120"
					placeholder="Your name"
				/>
			</label>
			<label class="block space-y-1.5">
				<span class="text-xs font-medium text-secondary"
					>Tags <span class="font-normal text-thirdly">(optional)</span></span
				>
				<input
					bind:value={globalState.presetLibrary.publishTags}
					class="h-9 w-full rounded-md border border-color bg-primary px-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
					type="text"
					placeholder="clean, subtitle, bold"
				/>
			</label>
			<label class="block space-y-1.5">
				<span class="text-xs font-medium text-secondary"
					>Description <span class="font-normal text-thirdly">(optional)</span></span
				>
				<textarea
					bind:value={globalState.presetLibrary.publishDescription}
					class="min-h-20 w-full resize-none rounded-md border border-color bg-primary px-3 py-2 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
					maxlength="600"
					placeholder="Shortly describe where this style works best."
				></textarea>
			</label>
		</div>

		{#if getCustomClipsForUI().length > 0}
			<div class="space-y-2 rounded-lg border border-color bg-primary/50 px-3 py-3">
				<span class="text-xs font-medium text-secondary">Style overlays to include</span>
				<p class="text-xs text-thirdly">
					Custom images are NOT bundled — users must replace them with their own image.
				</p>
				{#each getCustomClipsForUI() as clip (clip.id)}
					{@const label = getClipLabel(clip)}
					<label class="flex items-start gap-2 cursor-pointer select-none">
						<input
							type="checkbox"
							class="mt-0.5 accent-[var(--accent-primary)]"
							checked={includedCustomClipIds.has(clip.id)}
							onclick={(e) => toggleCustomClip(clip.id, e.currentTarget.checked)}
						/>
						<span class="text-sm text-primary">{label}</span>
					</label>
				{/each}
			</div>
		{/if}

		{#if inclusionChanged()}
			<div
				class="rounded-lg border border-yellow-400/35 bg-yellow-500/10 px-3 py-3 text-sm text-yellow-100"
			>
				<div class="flex items-start gap-2">
					<span class="material-icons-outlined text-base">refresh</span>
					<p class="min-w-0 flex-1 text-xs">Regenerate the preview before publishing.</p>
				</div>
			</div>
		{/if}

		{#if publishError}
			<div class="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-3 text-sm text-red-100">
				<div class="flex items-start gap-2">
					<span class="material-icons-outlined text-base">error</span>
					<p class="min-w-0 flex-1 text-xs">{publishError}</p>
				</div>
			</div>
		{/if}

		<div class="flex items-center justify-end gap-2 border-t border-color pt-4">
			<button class="btn px-3 py-2 text-sm" type="button" onclick={closePublishForm}>
				Cancel
			</button>
			<button
				class="btn-accent px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
				type="button"
				onclick={publishPreset}
				disabled={!canPublish()}
			>
				{isPublishing ? 'Publishing...' : 'Publish preset'}
			</button>
		</div>
	</section>
</div>
