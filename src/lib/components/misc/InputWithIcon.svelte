<script lang="ts">
	import 'material-icons/iconfont/material-icons.css';

	let {
		placeholder = 'Search...',
		icon = 'search',
		classes = '',
		value = $bindable()
	}: {
		placeholder?: string;
		icon?: string;
		classes?: string;
		value: string;
	} = $props();
</script>

<div class="relative">
	<span
		class="material-icons-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-secondary)]"
		>{icon}</span
	>
	<input class={"pl-11! " + classes} {placeholder} type="text" bind:value />
</div>
