<script lang="ts">
	import { fade } from 'svelte/transition';
	import { globalState } from '$lib/runes/main.svelte';
	import AiBoldModal from './modal/AiBoldModal.svelte';

	const translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);

	const hasActiveInlineStyle = $derived(
		() =>
			translationsEditorState().inlineStyleBoldEnabled ||
			translationsEditorState().inlineStyleItalicEnabled ||
			translationsEditorState().inlineStyleUnderlineEnabled
	);

	let showAiBoldModal = $state(false);

	function toggleStyle(
		property: 'inlineStyleBoldEnabled' | 'inlineStyleItalicEnabled' | 'inlineStyleUnderlineEnabled'
	): void {
		translationsEditorState()[property] = !translationsEditorState()[property];
	}
</script>

<section
	class="hidden 2xl:flex w-[330px] flex-shrink-0 max-h-full overflow-hidden flex-col border-l border-color border-t ml-1 rounded-lg bg-secondary"
>
	<div class="px-4 py-4 border-b border-color bg-primary/70">
		<div class="flex items-start gap-3">
			<div class="min-w-0">
				<h3 class="text-sm font-semibold text-primary">Translation Styles</h3>
				<p class="text-xs text-thirdly mt-1 leading-relaxed">
					Manual inline emphasis with a dedicated AI assistant modal for automatic bold styling.
				</p>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
		<button
			class={`w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
				translationsEditorState().isInlineStyleMode
					? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-secondary))] text-primary'
					: 'border-color bg-accent text-secondary hover:border-[var(--accent-primary)]/45 hover:text-primary'
			}`}
			onclick={() =>
				(translationsEditorState().isInlineStyleMode =
					!translationsEditorState().isInlineStyleMode)}
		>
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="text-sm font-semibold">Translation Style Editing</p>
					<p class="text-xs mt-1 opacity-80">
						{translationsEditorState().isInlineStyleMode ? 'Enabled' : 'Disabled'}
					</p>
				</div>
				<span class="material-icons text-lg">
					{translationsEditorState().isInlineStyleMode ? 'visibility' : 'edit_note'}
				</span>
			</div>
		</button>

		{#if translationsEditorState().isInlineStyleMode}
			<div class="space-y-2">
				<p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-thirdly">
					Styles To Toggle
				</p>

				<button
					class={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200 flex items-center justify-between ${
						translationsEditorState().inlineStyleBoldEnabled
							? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-secondary))] text-primary'
							: 'border-color bg-accent text-secondary hover:text-primary'
					}`}
					onclick={() => toggleStyle('inlineStyleBoldEnabled')}
				>
					<span class="flex items-center gap-2">
						<span class="material-icons text-base">format_bold</span>
						Bold
					</span>
					<span class="text-xs"
						>{translationsEditorState().inlineStyleBoldEnabled ? 'On' : 'Off'}</span
					>
				</button>

				<button
					class={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200 flex items-center justify-between ${
						translationsEditorState().inlineStyleItalicEnabled
							? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-secondary))] text-primary'
							: 'border-color bg-accent text-secondary hover:text-primary'
					}`}
					onclick={() => toggleStyle('inlineStyleItalicEnabled')}
				>
					<span class="flex items-center gap-2">
						<span class="material-icons text-base">format_italic</span>
						Italic
					</span>
					<span class="text-xs"
						>{translationsEditorState().inlineStyleItalicEnabled ? 'On' : 'Off'}</span
					>
				</button>

				<button
					class={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200 flex items-center justify-between ${
						translationsEditorState().inlineStyleUnderlineEnabled
							? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-secondary))] text-primary'
							: 'border-color bg-accent text-secondary hover:text-primary'
					}`}
					onclick={() => toggleStyle('inlineStyleUnderlineEnabled')}
				>
					<span class="flex items-center gap-2">
						<span class="material-icons text-base">format_underlined</span>
						Underline
					</span>
					<span class="text-xs"
						>{translationsEditorState().inlineStyleUnderlineEnabled ? 'On' : 'Off'}</span
					>
				</button>
			</div>

			<div
				class="rounded-xl border border-color bg-accent px-3 py-3 text-xs text-secondary leading-relaxed space-y-2"
			>
				<p class="font-semibold text-primary">How it works</p>
				<p>
					Enable style mode, keep one or more toggles active, then drag across words in the trimmed
					translation.
				</p>
				<p>
					The active toggles are flipped on the selected range. Editing the translation text later
					clears these inline styles.
				</p>
				{#if !hasActiveInlineStyle()}
					<p class="text-[var(--accent-primary)]">Select at least one style before applying it.</p>
				{/if}
			</div>

			<div class="rounded-xl border border-color bg-accent overflow-hidden">
				<div class="px-4 py-4 border-b border-color bg-primary/40">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="text-sm font-semibold text-primary">AI Assisted Translation Emphasis</div>
						</div>
					</div>
				</div>

				<div class="space-y-4 p-4">
					<button
						class="w-full rounded-lg bg-[var(--accent-primary)] px-4 py-3 text-sm font-semibold text-black transition-all duration-200 hover:brightness-110"
						onclick={() => (showAiBoldModal = true)}
					>
						Open AI Bold Assistant
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>

{#if showAiBoldModal}
	<div class="modal-wrapper" transition:fade>
		<AiBoldModal close={() => (showAiBoldModal = false)} />
	</div>
{/if}
