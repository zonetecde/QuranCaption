<script lang="ts">
	import { CustomTextClip } from '$lib/classes';
	import { CustomImageClip } from '$lib/classes/Clip.svelte';
	import type { Category, Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import { globalState } from '$lib/runes/main.svelte';
	import { get } from 'svelte/store';
	import StyleComponent from './Style.svelte';
	import { getVisibleCustomStyles } from './customContentStyleUtils';

	const searchQuery = $derived(globalState.getStylesState.searchQuery.toLowerCase().trim());

	/**
	 * Applique une valeur tout en synchronisant les bornes temporelles du clip.
	 * @param {Category} category Catégorie du clip personnalisé.
	 * @param {Style} style Style modifié.
	 * @param {Style['value']} value Nouvelle valeur.
	 * @returns {void}
	 */
	function applyStyleValue(category: Category, style: Style, value: Style['value']): void {
		const clip = globalState.getCustomClipTrack.getCustomClipWithId(category.id);
		if (!clip) {
			style.value = value;
			return;
		}

		if (style.id === 'time-appearance' && typeof value === 'number') {
			const endStyle = category.getStyle('time-disappearance');
			if (value > Number(endStyle?.value ?? 0)) {
				const endFallback = value + 3000;
				if (endStyle) endStyle.value = endFallback;
				clip.setEndTime(endFallback);
			}
			clip.setStartTime(value);
			style.value = value;
			return;
		}

		if (style.id === 'time-disappearance' && typeof value === 'number') {
			const beginStyle = category.getStyle('time-appearance');
			if (value < Number(beginStyle?.value ?? 0)) {
				const endFallback = value + 3000;
				if (beginStyle) beginStyle.value = value;
				clip.setStartTime(value);
				clip.setEndTime(endFallback);
				style.value = endFallback;
				return;
			}
			clip.setEndTime(value);
			style.value = value;
			return;
		}

		style.value = value;
	}
</script>

{#if globalState.getCustomClipTrack.clips.length === 0}
	<div class="style-empty-state mb-3">
		<span class="material-icons-outlined text-xl">add_photo_alternate</span>
		<p>{$LL.style.noCustomElements()}</p>
	</div>
{/if}

{#each globalState.getCustomClipTrack.clips as customClip (customClip.id)}
	{@const category = (customClip as CustomTextClip).category}
	{#if category && getVisibleCustomStyles(category, searchQuery).length > 0}
		<div class="style-category-block style-custom-card" data-category={category.id}>
			<div class="style-category-heading">
				<div class="flex min-w-0 items-center gap-2">
					<span class="material-icons-outlined text-[18px]! text-accent">
						{customClip instanceof CustomImageClip ? 'image' : 'title'}
					</span>
					<h4>{getStyleName(category.id, get(LL))}</h4>
				</div>
				<button
					type="button"
					class="text-secondary hover:text-danger-color"
					title={customClip instanceof CustomImageClip
						? ((
								$LL.editor as typeof $LL.editor & { removeCustomImage?: () => string }
							).removeCustomImage?.() ?? `${$LL.common.remove()} ${$LL.editor.customImage()}`)
						: $LL.editor.removeCustomText()}
					onclick={() => globalState.getCustomClipTrack.removeClip(Number(customClip.id))}
				>
					<span class="material-icons-outlined text-[18px]!">delete_outline</span>
				</button>
			</div>
			<div class="style-control-list">
				{#each getVisibleCustomStyles(category, searchQuery) as style (style.id)}
					<StyleComponent
						{style}
						showControl
						disabled={false}
						applyValueSimple={(value) => applyStyleValue(category, style, value)}
					/>
				{/each}
			</div>
		</div>
	{/if}
{/each}

<div class="mt-3 grid grid-cols-2 gap-2">
	<button
		type="button"
		class="btn-accent flex items-center justify-center gap-1 px-2 py-2 text-xs"
		onclick={() => void globalState.getVideoStyle.addCustomClip('text')}
		title={$LL.editor.addCustomText()}
	>
		<span class="material-icons-outlined text-sm">add</span>
		{$LL.editor.customText()}
	</button>
	<button
		type="button"
		class="btn-accent flex items-center justify-center gap-1 px-2 py-2 text-xs"
		onclick={() => void globalState.getVideoStyle.addCustomClip('image')}
		title={$LL.editor.customImage()}
	>
		<span class="material-icons-outlined text-sm">add</span>
		{$LL.editor.customImage()}
	</button>
</div>

<style>
	.style-category-block {
		border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
		border-radius: 0.75rem;
		padding: 0.65rem 0.7rem 0.2rem;
		background: color-mix(in srgb, var(--accent-primary) 4%, var(--bg-secondary));
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
	.style-control-list {
		display: flex;
		flex-direction: column;
	}
	.style-empty-state {
		display: flex;
		min-height: 8rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 1rem;
		border: 1px dashed var(--border-color);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--bg-accent) 45%, transparent);
		color: var(--text-secondary);
		font-size: 0.8rem;
		text-align: center;
	}
</style>
