<script lang="ts">
	import type { Style } from '$lib/classes';
	import type { Snippet } from 'svelte';

	let {
		compositeStyle,
		children
	}: {
		compositeStyle: Style;
		children: Snippet;
	} = $props();

	let getCss = $derived(() => {
		return compositeStyle.generateCSSForComposite();
	});
</script>

<p style={getCss()}>
	{@render children()}
</p>
