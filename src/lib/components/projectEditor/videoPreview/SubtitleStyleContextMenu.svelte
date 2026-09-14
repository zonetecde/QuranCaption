<script lang="ts">
	import type { Style, StyleName } from '$lib/classes/VideoStyle.svelte';
	import StyleComponent from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { get } from 'svelte/store';
	import { tick } from 'svelte';
	import ContextMenu from 'svelte-contextmenu';

	type StyleMenuEntry = {
		id: string;
		labelId: string;
		icon: string;
		styles: Style[];
	};

	const sharedStyleIds: StyleName[] = [
		'font-size',
		'font-family',
		'text-color',
		'horizontal-text-alignment',
		'vertical-text-alignment',
		'show-verse-number'
	];
	const arabicStyleIds: StyleName[] = ['mushaf-style', 'show-decorative-brackets'];
	const wbwStyleIds: StyleName[] = [
		'wbw-show-current-word-only',
		'wbw-reveal-on-recitation',
		'enable-wbw-highlight',
		'wbw-color'
	];

	let { target }: { target: string } = $props();
	let contextMenu: ContextMenu | undefined = $state();
	let hasOpened = $state(false);
	let activeEntryId: string | null = $state(null);
	let menuElement: HTMLLIElement | undefined = $state();
	let controlElement: HTMLDivElement | undefined = $state();
	let openControlToLeft = $state(false);
	let controlTop = $state(0);

	const entries = $derived.by((): StyleMenuEntry[] => {
		if (!hasOpened) return [];
		const targetStyles = globalState.getVideoStyle.getStylesOfTarget(target);
		const wbwStyles = wbwStyleIds.flatMap((styleId) => {
			const style = targetStyles.findStyle(styleId);
			return style ? [style] : [];
		});
		const styleIds = target === 'arabic' ? [...sharedStyleIds, ...arabicStyleIds] : sharedStyleIds;
		const styleEntries = styleIds.flatMap((styleId) => {
			const style = targetStyles.findStyle(styleId);
			if (!style) return [];
			const selectedClipIds = globalState.getStylesState.selectedSubtitles.map(
				(subtitle) => subtitle.id
			);
			const decorativeBracketsEnabled =
				styleId === 'show-decorative-brackets' &&
				(selectedClipIds.length > 0
					? selectedClipIds.some((clipId) =>
							Boolean(targetStyles.getEffectiveValue(styleId, clipId, undefined, 0))
						)
					: Boolean(style.value));
			const decorativeBracketsStyle = decorativeBracketsEnabled
				? targetStyles.findStyle('decorative-brackets-font-family')
				: undefined;
			return [
				{
					id: style.id,
					labelId: style.id,
					icon: style.icon,
					styles: decorativeBracketsStyle ? [style, decorativeBracketsStyle] : [style]
				}
			];
		});
		return [
			...(wbwStyles.length > 0
				? [
						{
							id: 'wbw-effect',
							labelId: 'word-by-word-highlight',
							icon: 'lyrics',
							styles: wbwStyles
						}
					]
				: []),
			...styleEntries
		];
	});
	const activeEntry = $derived(entries.find((entry) => entry.id === activeEntryId));

	/**
	 * Affiche les contrôles associés à l'entrée survolée ou sélectionnée.
	 * @param {string} entryId Identifiant de l'entrée à modifier.
	 * @param {HTMLButtonElement} trigger Élément servant d'ancrage au contrôle.
	 * @returns {Promise<void>} Promesse résolue après le positionnement du contrôle.
	 */
	async function activateEntry(entryId: string, trigger: HTMLButtonElement): Promise<void> {
		activeEntryId = entryId;
		await tick();
		if (!menuElement || !controlElement) return;
		const menuRect = menuElement.getBoundingClientRect();
		const triggerRect = trigger.getBoundingClientRect();
		const viewportTop = Math.min(
			triggerRect.top,
			window.innerHeight - controlElement.offsetHeight - 8
		);
		controlTop = Math.max(8, viewportTop) - menuRect.top;
		openControlToLeft = menuRect.right + controlElement.offsetWidth > window.innerWidth;
	}

	/**
	 * Ouvre les réglages essentiels du texte à la position du clic droit.
	 * @param {MouseEvent} event Clic droit effectué sur le sous-titre.
	 * @returns {Promise<void>} Promesse résolue après le rendu du menu.
	 */
	export async function show(event: MouseEvent): Promise<void> {
		event.preventDefault();
		hasOpened = true;
		activeEntryId = null;
		await tick();
		contextMenu?.show(event);
	}
</script>

<ContextMenu bind:this={contextMenu}>
	<li
		bind:this={menuElement}
		data-autoclose="false"
		class="relative w-64 whitespace-normal p-1"
		onmouseleave={() => (activeEntryId = null)}
	>
		{#each entries as entry (entry.id)}
			<button
				type="button"
				class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-primary transition-colors hover:bg-[var(--bg-accent)] focus:bg-[var(--bg-accent)] focus:outline-none"
				class:bg-[var(--bg-accent)]={activeEntryId === entry.id}
				onmouseenter={(event) => void activateEntry(entry.id, event.currentTarget)}
				onfocus={(event) => void activateEntry(entry.id, event.currentTarget)}
				onclick={(event) => void activateEntry(entry.id, event.currentTarget)}
			>
				<span class="material-icons-outlined text-[18px]! text-secondary">{entry.icon}</span>
				<span class="min-w-0 flex-1 truncate">{getStyleName(entry.labelId, get(LL))}</span>
				<span class="material-icons-outlined text-[18px]! text-secondary">chevron_right</span>
			</button>
		{/each}

		{#if activeEntry}
			<div
				bind:this={controlElement}
				class="absolute z-1 w-88 rounded-md border border-color bg-[var(--ctx-menu-background)] px-3 py-1 shadow-xl"
				style:top="{controlTop}px"
				class:left-full={!openControlToLeft}
				class:right-full={openControlToLeft}
			>
				{#each activeEntry.styles as style (style.id)}
					<StyleComponent
						{style}
						{target}
						disabled={false}
						showControl
						showKeyframeControls={false}
						applyValueSimple={(value) => (style.value = value as typeof style.value)}
					/>
				{/each}
			</div>
		{/if}
	</li>
</ContextMenu>
