<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	const aiv = globalState.aiVideo;
</script>

<div class="space-y-4">
	<div class="space-y-2">
		<label for="ai-prompt" class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">auto_awesome</span>
			{$LL.aiVideo.videoThemeLabel()}
		</label>
		<textarea
			id="ai-prompt"
			bind:value={aiv.video.prompt}
			rows={3}
			class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all"
			placeholder={$LL.aiVideo.videoThemeInputPlaceholder()}
		></textarea>
		<p class="text-xs text-thirdly">{$LL.aiVideo.videoThemeDescription()}</p>
	</div>

	<div class="space-y-2">
		<span class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">movie</span>
			{$LL.aiVideo.backgroundSourceLabel()}
		</span>
		<div class="flex gap-3">
			<button
				type="button"
				class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed! {aiv
					.video.sourceMode === 'ai'
					? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
					: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
				disabled
				onclick={() => (aiv.video.sourceMode = 'ai')}
			>
				<span class="material-icons text-base align-middle mr-1">auto_awesome</span>
				{$LL.aiVideo.generateVideoWithAI()}
			</button>
			<button
				type="button"
				class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {aiv
					.video.sourceMode === 'youtube'
					? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
					: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
				onclick={() => (aiv.video.sourceMode = 'youtube')}
			>
				<span class="material-icons text-base align-middle mr-1">smart_display</span>
				{$LL.aiVideo.downloadFromYouTube()}
			</button>
			<button
				type="button"
				class="shrink-0 rounded-xl border px-3 py-3 text-sm font-medium transition-all cursor-pointer {aiv
					.video.sourceMode === 'none'
					? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
					: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
				title={$LL.aiVideo.noBackground()}
				onclick={() => (aiv.video.sourceMode = 'none')}
			>
				<span class="material-icons text-base align-middle">block</span>
			</button>
		</div>
	</div>

	{#if aiv.video.sourceMode === 'youtube'}
		<div class="space-y-2">
			<label
				for="youtube-video-url"
				class="flex items-center gap-2 text-sm font-semibold text-primary"
			>
				<span class="material-icons text-accent-primary text-base">link</span>
				{$LL.aiVideo.youtubeVideoUrlLabel()}
			</label>
			<input
				id="youtube-video-url"
				type="text"
				bind:value={aiv.video.youtubeUrl}
				class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all"
				placeholder={$LL.aiVideo.youtubeUrlPlaceholder()}
			/>
			<p class="text-xs text-thirdly">
				{$LL.aiVideo.downloadedVideoOrientation()}
			</p>
		</div>
	{:else if aiv.video.sourceMode === 'none'}
		<p class="rounded-xl border border-dashed border-color bg-bg-secondary px-4 py-3 text-xs text-thirdly">
			{$LL.aiVideo.noBackgroundDescription()}
		</p>
	{/if}
</div>
