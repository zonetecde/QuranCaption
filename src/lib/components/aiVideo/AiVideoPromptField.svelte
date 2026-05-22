<script lang="ts">
	let { value = $bindable('') } = $props();
</script>

<div class="space-y-2">
	<label for="ai-prompt" class="flex items-center gap-2 text-sm font-semibold text-primary">
		<span class="material-icons text-accent-primary text-base">auto_awesome</span>
		Video Theme
	</label>
	<textarea
		id="ai-prompt"
		bind:value
		rows={3}
		class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all"
		placeholder="e.g. The importance to obey our parents"
	></textarea>
	<p class="text-xs text-thirdly">Describe the theme or topic for your video.</p>
</div>
