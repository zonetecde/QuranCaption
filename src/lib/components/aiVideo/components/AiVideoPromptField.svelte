<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';

	const aiv = globalState.aiVideo;
</script>

<div class="space-y-4">
	<div class="space-y-2">
		<label for="ai-prompt" class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">auto_awesome</span>
			Video Theme
		</label>
		<textarea
			id="ai-prompt"
			bind:value={aiv.video.prompt}
			rows={3}
			class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all"
			placeholder="e.g. The importance to obey our parents"
		></textarea>
		<p class="text-xs text-thirdly">Describe the theme or topic for your video.</p>
	</div>

	<div class="space-y-2">
		<span class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">movie</span>
			Background Source
		</span>
		<div class="flex gap-3">
			<button
				type="button"
				class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {aiv.video.sourceMode ===
				'ai'
					? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
					: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
				onclick={() => (aiv.video.sourceMode = 'ai')}
			>
				<span class="material-icons text-base align-middle mr-1">auto_awesome</span>
				Generate video with AI
			</button>
			<button
				type="button"
				class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {aiv.video.sourceMode ===
				'youtube'
					? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
					: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
				onclick={() => (aiv.video.sourceMode = 'youtube')}
			>
				<span class="material-icons text-base align-middle mr-1">smart_display</span>
				Download from YouTube
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
				YouTube Video URL
			</label>
			<input
				id="youtube-video-url"
				type="text"
				bind:value={aiv.video.youtubeUrl}
				class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all"
				placeholder="https://www.youtube.com/watch?v=..."
			/>
			<p class="text-xs text-thirdly">
				The downloaded video's own orientation will be used automatically.
			</p>
		</div>
	{/if}
</div>
