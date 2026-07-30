<script lang="ts">
	import { fade } from 'svelte/transition';
	import MobileSideDrawers from '$lib/components/misc/MobileSideDrawers.svelte';
	import AddTranslationModal from './modal/AddTranslationModal.svelte';
	import TranslationInlineStylePanel from './TranslationInlineStylePanel.svelte';
	import TranslationsEditorSettings from './leftPanel/TranslationsEditorSettings.svelte';
	import Workspace from './workspace/Workspace.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	let addTranslationModalVisibility = $state(false);
	let leftDrawerOpen = $state(false);
	let rightDrawerOpen = $state(false);
</script>

<div class="translations-editor-mobile-shell">
	<section class="translations-editor-toolbar">
		<button
			class="drawer-toggle"
			class:drawer-open={leftDrawerOpen}
			type="button"
			aria-label={$LL.editor.translations()}
			aria-expanded={leftDrawerOpen}
			onclick={() => {
				leftDrawerOpen = !leftDrawerOpen;
				rightDrawerOpen = false;
			}}
		>
			<span class="material-icons">tune</span>
		</button>

		<h2 class="translations-editor-title">{$LL.editor.translations()}</h2>

		<button
			class="drawer-toggle"
			class:drawer-open={rightDrawerOpen}
			type="button"
			aria-label={$LL.editor.wordStyles()}
			aria-expanded={rightDrawerOpen}
			onclick={() => {
				rightDrawerOpen = !rightDrawerOpen;
				leftDrawerOpen = false;
			}}
		>
			<span class="material-icons">format_paint</span>
		</button>
	</section>

	<section class="translations-editor-workspace">
		<Workspace
			setAddTranslationModalVisibility={(visible: boolean) =>
				(addTranslationModalVisibility = visible)}
		/>
	</section>

	<MobileSideDrawers bind:leftOpen={leftDrawerOpen} bind:rightOpen={rightDrawerOpen}>
		{#snippet leftContent()}
			<TranslationsEditorSettings
				setAddTranslationModalVisibility={(visible: boolean) =>
					(addTranslationModalVisibility = visible)}
			/>
		{/snippet}
		{#snippet rightContent()}
			<TranslationInlineStylePanel />
		{/snippet}
	</MobileSideDrawers>
</div>

{#if addTranslationModalVisibility}
	<div class="modal-wrapper" transition:fade>
		<AddTranslationModal close={() => (addTranslationModalVisibility = false)} />
	</div>
{/if}

<style>
	.translations-editor-mobile-shell {
		position: relative;
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		flex-direction: column;
		gap: 0.5rem;
		overflow: hidden;
		padding: 0.5rem;
	}

	.translations-editor-toolbar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
	}

	.translations-editor-title {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-align: center;
		font-size: 1rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-primary);
	}

	.translations-editor-workspace {
		display: flex;
		flex: 1 1 0;
		min-height: 0;
		overflow: hidden;
	}

	.drawer-toggle {
		z-index: 40;
		display: flex;
		flex-shrink: 0;
		height: 2.5rem;
		width: 2.5rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
	}

	.drawer-toggle.drawer-open {
		color: var(--accent-primary);
	}

	@media (orientation: landscape) {
		.translations-editor-mobile-shell {
			gap: 0.4rem;
			padding: 0.4rem;
		}
	}
</style>
