<script lang="ts">
	type Props = {
		prompt: string;
	};

	let { prompt = $bindable() }: Props = $props();
</script>

<div class="relative">
	<span
		class="material-icons pointer-events-none absolute right-2 top-2 text-[22px] text-accent-primary"
	>
		auto_awesome
	</span>
	<textarea
		id="ai-video-prompt"
		bind:value={prompt}
		class="prompt-input min-h-32 w-full resize-none rounded-[28px] border border-color bg-secondary py-6 pl-16 pr-6 text-lg leading-7 text-primary shadow-2xl shadow-black/30 outline-none transition-colors duration-200 placeholder:text-thirdly focus:border-color focus:shadow-2xl focus:shadow-black/30"
		rows="4"
		placeholder="E.g., A video about the importance of obeying our parents"
	></textarea>
</div>

<style>
	.prompt-input {
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--bg-secondary) 94%, white) 0%,
				var(--bg-secondary) 100%
			),
			var(--bg-secondary);
	}

	.prompt-input:focus {
		border-color: var(--border-color) !important;
		box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.8) !important;
		--tw-ring-color: transparent !important;
		--tw-ring-shadow: 0 0 #0000 !important;
	}
</style>
