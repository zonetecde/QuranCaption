<script lang="ts">
	import toast from 'svelte-5-french-toast';

	let { toast: t } = $props();
</script>

<div
	class="bg-secondary border border-[var(--accent-primary)] rounded-lg shadow-lg p-4 flex items-start cursor-pointer hover:bg-black/20"
	onclick={() => toast.dismiss(t.id)}
	onkeypress={(e) => e.key === 'Enter' && toast.dismiss(t.id)}
	role="button"
	tabindex="0"
>
	<span class="material-icons text-[var(--accent-primary)] text-xl mr-3 mt-0.5">auto_awesome</span>
	<div class="flex-1">
		<h3 class="text-sm font-bold text-primary">Native Auto-Segmentation Available</h3>
		<p class="text-xs text-secondary mt-1">
			This Surah has official timing data! Add it to the timeline, then look for the
			<span class="text-[var(--accent-primary)]">Mp3Quran Auto-Segment</span> option in the Subtitles
			Editor.
		</p>
	</div>
	<button class="ml-2 text-secondary hover:text-primary" onclick={(e) => {
		e.stopPropagation();
		toast.dismiss(t.id);
	}}><span class="material-icons text-sm">close</span></button>
</div>
