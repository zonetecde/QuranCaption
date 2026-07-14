<script lang="ts">
	import { ClipWithTranslation } from '$lib/classes/Clip.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	const translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);
	type InlineStyleProperty =
		| 'inlineStyleBoldEnabled'
		| 'inlineStyleItalicEnabled'
		| 'inlineStyleUnderlineEnabled'
		| 'inlineStyleLineBreakEnabled'
		| 'inlineStyleColorEnabled';

	const styleButtons: Array<{
		property: Exclude<InlineStyleProperty, 'inlineStyleColorEnabled'>;
		icon: string;
		label: () => string;
	}> = [
		{ property: 'inlineStyleBoldEnabled', icon: 'format_bold', label: () => $LL.editor.bold() },
		{
			property: 'inlineStyleItalicEnabled',
			icon: 'format_italic',
			label: () => $LL.editor.italic()
		},
		{
			property: 'inlineStyleUnderlineEnabled',
			icon: 'format_underlined',
			label: () => $LL.editor.underline()
		},
		{
			property: 'inlineStyleLineBreakEnabled',
			icon: 'keyboard_return',
			label: () => $LL.editor.newLine()
		}
	];

	const hasActiveInlineStyle = $derived(
		() =>
			translationsEditorState().inlineStyleBoldEnabled ||
			translationsEditorState().inlineStyleItalicEnabled ||
			translationsEditorState().inlineStyleUnderlineEnabled ||
			translationsEditorState().inlineStyleLineBreakEnabled ||
			translationsEditorState().inlineStyleColorEnabled
	);

	/**
	 * Active ou désactive un style à appliquer aux mots sélectionnés.
	 * @param {InlineStyleProperty} property Propriété du style dans l'état de l'éditeur.
	 * @returns {void}
	 */
	function toggleStyle(property: InlineStyleProperty): void {
		translationsEditorState()[property] = !translationsEditorState()[property];
	}

	/**
	 * Supprime tous les styles mot par mot des traductions du projet.
	 * @returns {Promise<void>} Promesse résolue après la réinitialisation.
	 */
	async function resetAllInlineStyles(): Promise<void> {
		const confirmed = await ModalManager.confirmModal($LL.translations.resetInlineStylesConfirm());
		if (!confirmed) return;

		ProjectHistoryManager.track('reset translation inline styles', () => {
			for (const clip of globalState.getSubtitleTrack.clips) {
				if (!(clip instanceof ClipWithTranslation)) continue;
				for (const translation of Object.values(clip.translations)) {
					if (translation instanceof VerseTranslation) translation.clearInlineStyles();
				}
			}
		});
		globalState.updateVideoPreviewUI();
	}
</script>

<div class="px-4 py-4 border-b border-color bg-primary/70">
	<h3 class="text-sm font-semibold text-primary">{$LL.editor.wordStyles()}</h3>
	<p class="text-xs text-thirdly mt-1 leading-relaxed">{$LL.editor.wordStylesDescription()}</p>
</div>

<div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
	<button
		class={`w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
			translationsEditorState().isInlineStyleMode
				? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-secondary))] text-primary'
				: 'border-color bg-accent text-secondary hover:border-[var(--accent-primary)]/45 hover:text-primary'
		}`}
		onclick={() =>
			(translationsEditorState().isInlineStyleMode = !translationsEditorState().isInlineStyleMode)}
	>
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm font-semibold">{$LL.editor.wordStyleEditing()}</p>
				<p class="text-xs mt-1 opacity-80">
					{translationsEditorState().isInlineStyleMode
						? $LL.common.enabled()
						: $LL.common.disabled()}
				</p>
			</div>
			<span class="material-icons text-lg">
				{translationsEditorState().isInlineStyleMode ? 'visibility' : 'edit_note'}
			</span>
		</div>
	</button>

	{#if translationsEditorState().isInlineStyleMode}
		<div class="space-y-2">
			{#each styleButtons as item (item.property)}
				<button
					class={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium flex items-center justify-between ${
						translationsEditorState()[item.property]
							? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/12 text-primary'
							: 'border-color bg-accent text-secondary'
					}`}
					onclick={() => toggleStyle(item.property)}
				>
					<span class="flex items-center gap-2">
						<span class="material-icons text-base">{item.icon}</span>
						{item.label()}
					</span>
				</button>
			{/each}

			<div class="rounded-lg border border-color bg-accent px-3 py-2">
				<div class="flex items-center justify-between gap-3">
					<button
						class="flex flex-1 items-center gap-2 text-sm text-primary"
						onclick={() => toggleStyle('inlineStyleColorEnabled')}
					>
						<span
							class="h-4 w-4 rounded-full border border-white/20"
							style={`background-color: ${translationsEditorState().inlineStyleColorValue};`}
						></span>
						{$LL.editor.color()}
					</button>
					<input
						type="color"
						value={translationsEditorState().inlineStyleColorValue}
						oninput={(event) =>
							(translationsEditorState().inlineStyleColorValue = event.currentTarget.value)}
						class="h-8 w-10 rounded border border-color bg-secondary p-1"
					/>
				</div>
			</div>
		</div>

		<div class="rounded-xl border border-color bg-accent px-3 py-3 text-xs text-secondary">
			<p>{$LL.editor.howItWorksDescription1()}</p>
			{#if !hasActiveInlineStyle()}
				<p class="mt-2 text-[var(--accent-primary)]">{$LL.editor.selectAtLeastOneStyle()}</p>
			{/if}
		</div>

		<button
			class="w-full rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-sm font-semibold text-red-300"
			onclick={() => void resetAllInlineStyles()}
		>
			{$LL.editor.resetAllSegmentStyles()}
		</button>
	{/if}
</div>
