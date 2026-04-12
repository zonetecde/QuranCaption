<script lang="ts">
	type ActivityEntry = {
		id: string;
		step: string;
		message: string;
		tone: 'info' | 'success' | 'error';
	};

	let {
		activityLog,
		title = 'Activity log',
		maxHeightClass = 'max-h-72',
		containerClass = 'rounded-xl border border-color bg-secondary p-4'
	}: {
		activityLog: ActivityEntry[];
		title?: string;
		maxHeightClass?: string;
		containerClass?: string;
	} = $props();
</script>

<div class={containerClass}>
	<div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-thirdly">{title}</div>
	<div
		class={`${maxHeightClass} overflow-y-auto rounded-lg border border-color bg-accent px-3 py-2 text-[12px] leading-5 [font-family:Consolas,monospace]`}
	>
		{#if activityLog.length === 0}
			<div class="text-thirdly">No activity yet.</div>
		{:else}
			{#each activityLog as entry (entry.id)}
				<div
					class={`border-b border-color/50 py-1.5 last:border-b-0 ${
						entry.tone === 'error'
							? 'text-red-200'
							: entry.tone === 'success'
								? 'text-green-200'
								: 'text-secondary'
					}`}
				>
					<span class="mr-2 uppercase opacity-70">[{entry.step}]</span>
					<span>{entry.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
