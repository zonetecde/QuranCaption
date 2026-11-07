<script lang="ts">
	import type { Style } from '$lib/classes';
	import type { Snippet } from 'svelte';
	import NativeTextEffects from '../../videoPreview/NativeTextEffects.svelte';

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

<p class="whitespace-pre-line" style={getCss()}>
	<NativeTextEffects css={getCss()}>{@render children()}</NativeTextEffects>
</p>
