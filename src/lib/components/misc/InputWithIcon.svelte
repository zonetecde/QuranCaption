<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import 'material-icons/iconfont/material-icons.css';

	let {
		placeholder = $LL.common.search(),
		icon = 'search',
		classes = '',
		value = $bindable()
	}: {
		placeholder?: string;
		icon?: string;
		classes?: string;
		value: string;
	} = $props();

	/**
	 * Efface la valeur de l'input.
	 */
	function clearValue(): void {
		value = '';
	}
</script>

<div class="relative">
	<span
		class="material-icons-outlined absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-secondary)]"
		>{icon}</span
	>
	<input class={'pl-11! pr-9! ' + classes} {placeholder} type="text" bind:value />
	{#if value}
		<button
			type="button"
			class="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-thirdly)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
			onclick={clearValue}
			aria-label={$LL.editor.clearSearch()}
		>
			<span class="material-icons-outlined text-base">close</span>
		</button>
	{/if}
</div>
