<script lang="ts">
	let {
		selectedSource = $bindable<'qdc' | 'mp3quran'>()
	}: {
		selectedSource: 'qdc' | 'mp3quran';
	} = $props();

	const tabs = [
		{ id: 'qdc', label: 'Quran.com' },
		{ id: 'mp3quran', label: 'MP3Quran' }
	] as const;
</script>

<div class="grid grid-cols-2 gap-2 rounded-xl border border-color bg-secondary p-1">
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			class={`rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
				selectedSource === tab.id
					? 'bg-[var(--accent-primary)] text-black shadow-sm'
					: 'text-secondary hover:bg-[var(--bg-accent)] hover:text-primary'
			}`}
			onclick={() => (selectedSource = tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</div>
