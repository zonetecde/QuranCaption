<script lang="ts">
	type Props = {
		selectedModel: string;
		selectedResolution: string;
	};

	const mockModels = [
		'Mock Provider / Cinematic Nature',
		'Mock Provider / Abstract Light',
		'Mock Provider / Rainy Sky'
	];
	const resolutions = ['Portrait', 'Landscape'];

	let { selectedModel = $bindable(), selectedResolution = $bindable() }: Props = $props();
</script>

<div class="flex min-w-0 flex-wrap items-center gap-3">
	<label
		for="ai-video-model"
		class="control-pill flex min-w-0 flex-1 items-center gap-2 rounded-full border border-color bg-primary px-4 py-2.5"
	>
		<span class="material-icons text-[20px] text-accent-primary">movie</span>
		<select
			id="ai-video-model"
			bind:value={selectedModel}
			class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-primary shadow-none outline-none"
			aria-label="Provider / model"
		>
			{#each mockModels as model (model)}
				<option value={model}>{model}</option>
			{/each}
		</select>
	</label>

	<label
		for="ai-video-resolution"
		class="control-pill flex min-w-44 items-center gap-2 rounded-full border border-color bg-primary px-4 py-2.5"
	>
		<span class="material-icons text-[20px] text-accent-primary">aspect_ratio</span>
		<select
			id="ai-video-resolution"
			bind:value={selectedResolution}
			class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-primary shadow-none outline-none"
			aria-label="Resolution"
		>
			{#each resolutions as resolution (resolution)}
				<option value={resolution}>{resolution}</option>
			{/each}
		</select>
	</label>
</div>

<style>
	.control-pill select {
		border: 0 !important;
		background-color: transparent !important;
		box-shadow: none !important;
	}

	.control-pill option {
		background-color: var(--bg-accent);
		color: var(--text-primary);
	}
</style>
