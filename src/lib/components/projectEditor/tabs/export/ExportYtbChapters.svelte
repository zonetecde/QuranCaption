<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import { SubtitleClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';

	onMount(() => {
		const uniqueSurahs = new Set<number>();

		for (const clip of globalState.getSubtitleClips) {
			if (clip instanceof SubtitleClip) {
				uniqueSurahs.add(clip.surah);
				if (uniqueSurahs.size > 1) {
					break;
				}
			}
		}

		if (uniqueSurahs.size === 1 && globalState.getExportState.ytbChaptersChoice === 'Each Surah') {
			globalState.getExportState.ytbChaptersChoice = 'Each Verse';
		}
	});
</script>

<!-- Export YouTube Chapters Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">Export YouTube Chapters</h3>
		<p class="text-thirdly text-sm">
			Create a YouTube chapter file that you can include in your video description for automatic
			timing navigation.
		</p>
	</div>

	<!-- Chapter Generation Options -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Chapter Generation</h4>
		<p class="text-thirdly text-sm mb-4">Choose how to organize your video chapters:</p>

		<div class="space-y-4">
			<label
				class="flex items-center gap-3 cursor-pointer group bg-accent rounded-lg p-4 border border-color hover:border-accent-primary transition-colors"
			>
				<input
					type="radio"
					name="ytb-chapters"
					value="Each Surah"
					checked={globalState.getExportState.ytbChaptersChoice === 'Each Surah'}
					onchange={(e: any) => (globalState.getExportState.ytbChaptersChoice = e.target.value)}
					class="w-4 h-4 text-accent-primary"
				/>
				<div class="flex-1">
					<span class="text-secondary font-medium group-hover:text-primary transition-colors">
						Chapter per Surah
					</span>
					<p class="text-thirdly text-xs mt-1">
						Create a new chapter each time the Surah changes. Best for videos covering multiple
						Surahs.
					</p>
				</div>
			</label>

			<label
				class="flex items-center gap-3 cursor-pointer group bg-accent rounded-lg p-4 border border-color hover:border-accent-primary transition-colors"
			>
				<input
					type="radio"
					name="ytb-chapters"
					value="Each Verse"
					checked={globalState.getExportState.ytbChaptersChoice === 'Each Verse'}
					onchange={(e: any) => (globalState.getExportState.ytbChaptersChoice = e.target.value)}
					class="w-4 h-4 text-accent-primary"
				/>
				<div class="flex-1">
					<span class="text-secondary font-medium group-hover:text-primary transition-colors">
						Chapter per Verse
					</span>
					<p class="text-thirdly text-xs mt-1">
						Create a new chapter for each verse. Ideal for detailed verse-by-verse navigation.
					</p>
				</div>
			</label>
		</div>
	</div>

	<!-- Usage Instructions -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">How to Use</h4>
		<div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
			<div class="flex items-start gap-3">
				<div class="text-blue-400 text-lg flex-shrink-0">ℹ️</div>
				<div>
					<span class="text-blue-200 text-sm font-medium">YouTube Integration</span>
					<p class="text-blue-100/80 text-xs mt-1">
						Copy the generated chapter text and paste it into your YouTube video description.
						YouTube will automatically create interactive chapters for your viewers.
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportYtbChapters}>
			Export YouTube Chapters
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			Generate chapter timestamps for your YouTube video description
		</p>
	</div>
</div>
