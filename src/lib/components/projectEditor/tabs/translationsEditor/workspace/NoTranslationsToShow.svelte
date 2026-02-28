<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
</script>

<div
	class="flex items-center justify-center h-full bg-gradient-to-br from-bg-primary to-bg-secondary"
>
	<div class="text-center max-w-lg mx-6">
		<!-- Icon with glassmorphism effect -->
		<div class="relative mb-8">
			<div class="absolute inset-0 bg-white/40 opacity-20 rounded-full blur-xl"></div>
			<div
				class="relative inline-flex items-center justify-center w-24 h-24 bg-accent border border-color rounded-full backdrop-blur-sm"
			>
				<div
					class="absolute inset-2 bg-gradient-to-br from-accent-primary/10 to-transparent rounded-full"
				></div>
				<span class="material-icons text-accent text-4xl relative z-10">search_off</span>
			</div>
		</div>

		<!-- Main title -->
		<h3 class="text-2xl font-bold text-primary mb-4 tracking-tight">
			No Subtitles Match Your Filters
		</h3>

		<!-- Description with better typography -->
		<p class="text-secondary text-base leading-relaxed mb-8 px-4">
			All your subtitles are either completed or don't match the current filter settings. Try
			adjusting your filters in the Translation Settings panel, including overlap filtering.
		</p>
		<!-- Quick actions with modern design -->
		<div class="bg-accent/50 border border-color/50 rounded-xl p-6 backdrop-blur-sm">
			<div class="flex items-center gap-2 mb-4">
				<span class="material-icons text-accent text-sm">flash_on</span>
				<p class="text-sm font-medium text-secondary">Quick actions</p>
			</div>

			<div class="flex flex-col gap-3">
				<button
					class="group flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-color/30 hover:bg-accent hover:border-blue-300/50 transition-all duration-200 text-left cursor-pointer"
					onclick={() => {
						globalState.getTranslationsState.searchQuery = '';
						globalState.getTranslationsState.onlyShowOverlappingSubtitles = false;
						// Reset all filters to show everything
						Object.keys(globalState.getTranslationsState.filters).forEach((key) => {
							globalState.getTranslationsState.filters[key] = true;
						});
					}}
				>
					<span class="material-icons text-accent group-hover:text-accent-primary text-lg"
						>refresh</span
					>
					<span
						class="text-sm text-secondary group-hover:text-primary transition-colors cursor-pointer"
					>
						Reset all filters
					</span>
				</button>

				<button
					class="group flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-color/30 hover:bg-accent hover:border-blue-300/50 transition-all duration-200 text-left cursor-pointer"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(['to review', 'ai error']);
					}}
				>
					<span class="material-icons text-accent group-hover:text-accent-primary text-lg"
						>rate_review</span
					>
					<span class="text-sm text-secondary group-hover:text-primary transition-colors">
						Show only subtitles that need review
					</span>
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Subtle background gradient */
	.bg-gradient-to-br {
		background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
	}
</style>
