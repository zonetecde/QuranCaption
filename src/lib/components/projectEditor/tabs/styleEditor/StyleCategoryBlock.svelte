<script lang="ts">
	import type { Category, Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { get } from 'svelte/store';
	import StyleComponent from './Style.svelte';
	import type { StyleControlGroup, StyleUiCopyKey } from './styleEditorTypes';

	let {
		category,
		visibleStyles,
		styleGroups,
		headerStyle,
		target,
		searchActive,
		mushafFontLocked,
		backgroundRequiresMaxHeight,
		wordByWordHint,
		isStyleDisabled,
		getStyleUiCopy
	}: {
		category: Category;
		visibleStyles: Style[];
		styleGroups: StyleControlGroup[];
		headerStyle?: Style;
		target: string;
		searchActive: boolean;
		mushafFontLocked: boolean;
		backgroundRequiresMaxHeight: boolean;
		wordByWordHint: 'arabic' | 'translation' | null;
		isStyleDisabled: (category: Category, style: Style) => boolean;
		getStyleUiCopy: (key: StyleUiCopyKey) => string;
	} = $props();
</script>

<div
	class="style-category-block"
	class:style-category-block-collapsed={!!headerStyle && visibleStyles.length === 0}
	data-category={category.id}
>
	<div class="style-category-heading">
		<span class="material-icons-outlined text-[18px]! text-accent">{category.icon}</span>
		<h4>{getStyleName(category.id, get(LL)) || category.name}</h4>
		{#if headerStyle}
			<div class="style-category-header-control">
				<StyleComponent
					style={headerStyle}
					{target}
					disabled={isStyleDisabled(category, headerStyle)}
					headerControl
					applyValueSimple={(value) => (headerStyle.value = value as typeof headerStyle.value)}
				/>
			</div>
		{/if}
	</div>

	{#if backgroundRequiresMaxHeight}
		<div class="style-inline-hint style-inline-hint-warning">
			<span class="material-icons-outlined text-sm">info</span>
			<p>{$LL.editor.backgroundVisibilityHint()}</p>
		</div>
	{/if}

	{#if category.id === 'text' && mushafFontLocked}
		<div class="style-inline-hint">
			<span class="material-icons-outlined text-sm">lock</span>
			<p>{getStyleUiCopy('fontControlledByMushaf')}</p>
		</div>
	{/if}

	{#if category.id === 'word-by-word-highlight' && wordByWordHint}
		<div class="style-inline-hint style-inline-hint-warning">
			<span class="material-icons-outlined text-sm">info</span>
			<div>
				{#if wordByWordHint === 'translation'}
					<p>{$LL.style.translationWbwMissingMappingInfo()}</p>
				{:else}
					<p>{$LL.style.wbwMissingInfo()}</p>
					<p class="mt-1">{$LL.style.wbwStep1()}</p>
					<p class="mt-1">{$LL.style.wbwStep2()}</p>
				{/if}
			</div>
		</div>
	{/if}

	<div class="style-control-groups">
		{#each styleGroups as group (group.label ?? group.styles.map((style) => style.id).join(':'))}
			<div class="style-control-group">
				{#if group.label}
					<div class="style-control-group-heading"><span>{getStyleUiCopy(group.label)}</span></div>
				{/if}
				<div class="style-control-list">
					{#each group.styles as style (style.id)}
						<StyleComponent
							{style}
							{target}
							showControl
							disabled={isStyleDisabled(category, style)}
							applyValueSimple={(value) => (style.value = value as typeof style.value)}
						/>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	{#if category.id === 'general' && target === 'global' && !searchActive}
		<div class="mt-2 flex items-center justify-between gap-3 border-t border-color pt-2">
			<div class="min-w-0">
				<p class="text-sm font-medium text-primary">{$LL.style.hifzMode()}</p>
				<p class="mt-0.5 text-xs leading-relaxed text-secondary">
					{$LL.style.createMemorizationVideos()}
				</p>
			</div>
			<button
				type="button"
				class="btn shrink-0 px-2 py-1.5 text-xs"
				onclick={() => void ModalManager.hifzRepetitionModal()}
			>
				{$LL.style.enableHifzMode()}
			</button>
		</div>
	{/if}
</div>

<style>
	.style-category-block {
		border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
		border-radius: 0.75rem;
		padding: 0.65rem 0.7rem 0.2rem;
		background: color-mix(in srgb, var(--bg-secondary) 62%, transparent);
		transition:
			border-color 200ms ease,
			background 200ms ease;
	}
	.style-category-block-collapsed {
		padding-bottom: 0.65rem;
	}
	.style-category-block-collapsed .style-category-heading {
		margin-bottom: 0;
		padding-bottom: 0;
		border-bottom: 0;
	}
	.style-category-block-collapsed .style-control-groups {
		display: none;
	}
	.style-category-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.1rem;
		padding: 0 0.05rem 0.55rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
	}
	.style-category-heading h4 {
		min-width: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.style-category-header-control {
		margin-left: auto;
	}
	.style-control-list,
	.style-control-groups {
		display: flex;
		flex-direction: column;
	}
	.style-control-groups {
		gap: 0.35rem;
	}
	.style-control-group-heading {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.15rem 0.1rem;
		color: var(--text-thirdly);
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.065em;
		text-transform: uppercase;
	}
	.style-control-group-heading::after {
		content: '';
		min-width: 1rem;
		height: 1px;
		flex: 1;
		background: color-mix(in srgb, var(--border-color) 45%, transparent);
	}
	.style-inline-hint {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
		padding: 0.45rem 0.5rem;
		border: 1px solid rgb(56 189 248 / 30%);
		border-radius: 0.5rem;
		background: rgb(14 165 233 / 8%);
		color: var(--text-secondary);
		font-size: 0.7rem;
		line-height: 1.35;
	}
	.style-inline-hint-warning {
		border-color: rgb(251 191 36 / 35%);
		background: rgb(245 158 11 / 9%);
		color: var(--text-primary);
	}
</style>
