<script lang="ts">
	import {
		type Style,
		type Category,
		VideoStyle,
		type StyleCategoryName
	} from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import Section from '../../Section.svelte';
	import StyleComponent from './Style.svelte';
	import ImportExportStyle from './ImportExportStyle.svelte';
	import { fade, slide } from 'svelte/transition';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { CustomTextClip } from '$lib/classes';

	const getCategoriesToDisplay = $derived(() => {
		return globalState.getVideoStyle.getStylesOfTarget(
			globalState.getStylesState.getCurrentSelection()
		).categories;
	});

	let stylesContainer: HTMLDivElement | undefined;
	let importExportMenuVisible = $state(false);

	onMount(async () => {
		stylesContainer!.scrollTop =
			globalState.currentProject!.projectEditorState.stylesEditor.scrollPosition;

		if (
			globalState.getStylesState.currentSelectionTranslation === '' &&
			globalState.getProjectTranslation.addedTranslationEditions.length > 0
		) {
			// Par défaut, on sélectionne la première traduction ajoutée
			globalState.getStylesState.currentSelectionTranslation =
				globalState.getProjectTranslation.addedTranslationEditions[0].name;
		}

		// S'il manque des styles à une traduction, on les ajoute
		for (const translation of globalState.getProjectTranslation.addedTranslationEditions) {
			if (globalState.getVideoStyle.doesTargetStyleExist(translation.name)) continue;

			await globalState.getVideoStyle.addStylesForEdition(translation.name);
		}
	});

	function clearSearch() {
		globalState.getStylesState.searchQuery = '';
	}

	/**
	 * Bascule l'affichage du menu Import/Export
	 */
	function toggleImportExportMenu() {
		importExportMenuVisible = !importExportMenuVisible;
	}

	// Fermer le menu en cliquant à l'extérieur
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (!target.closest('.import-export-menu') && !target.closest('.import-export-button')) {
			importExportMenuVisible = false;
		}
	}

	$effect(() => {
		const _ = globalState.getStylesState.scrollAndHighlight;

		if (_) {
			// Scroll to the highlighted category
			const category = globalState.getStylesState.scrollAndHighlight;
			const element = stylesContainer!.querySelector(`[data-category="${category}"]`);
			if (element) {
				element.scrollIntoView({ behavior: 'smooth', block: 'start' });
				// Le met en jaune pendant 2 secondes
				element.classList.add('highlight');
				setTimeout(() => {
					element.classList.remove('highlight');
				}, 2000);
			}

			globalState.getStylesState.scrollAndHighlight = null;
		}
	});
</script>

<svelte:window on:click={handleClickOutside} />

<div
	class="bg-secondary h-full border border-color mx-0.5 rounded-xl relative flex flex-col shadow"
>
	<!-- En-tête avec icône -->
	<div class="flex gap-x-2 items-center px-3 mb-2 mt-4">
		<span class="material-icons-outlined text-accent text-2xl">auto_fix_high</span>
		<h2 class="text-xl font-semibold text-primary tracking-wide">Style Editor</h2>

		<div class="relative ml-auto">
			<button
				class="import-export-button btn-accent flex flex-row items-center px-2 py-1 gap-x-2 text-sm"
				onclick={toggleImportExportMenu}
			>
				<span class="material-icons-outlined text-[20px]!">content_paste</span>Import/Export
			</button>
			<ImportExportStyle bind:isVisible={importExportMenuVisible} />
		</div>
	</div>

	<div
		class="flex flex-col px-3 py-3 bg-[var(--bg-primary)]/60 border border-b-0 rounded-b-none border-[var(--border-color)]/50 rounded-xl gap-y-2"
	>
		<p class="text-sm text-secondary">Choose a target</p>
		<div class="w-full grid grid-cols-3 gap-2">
			{#each ['global', 'arabic', 'translation'] as selection}
				<button
					onclick={() => {
						globalState.getStylesState.currentSelection = selection as
							| 'global'
							| 'arabic'
							| 'translation';
					}}
					class={'py-1.5 px-2 rounded-lg flex items-center justify-center gap-1  ' +
						(globalState.getStylesState.currentSelection === selection
							? 'btn-accent ring-1 ring-white/20'
							: 'btn hover:ring-1 hover:ring-white/10')}
					aria-pressed={globalState.getStylesState.currentSelection === selection}
					title={selection.charAt(0).toUpperCase() + selection.slice(1)}
				>
					<span class="text-sm">{selection.charAt(0).toUpperCase() + selection.slice(1)}</span>
				</button>
			{/each}
		</div>

		{#if globalState.getStylesState.currentSelection === 'translation'}
			{#if globalState.getProjectTranslation.addedTranslationEditions.length > 0}
				<div class="flex items-center gap-2 mt-1">
					<span class="material-icons-outlined text-secondary text-sm"> translate </span>
					<select
						class="flex-1"
						bind:value={globalState.getStylesState.currentSelectionTranslation}
						transition:slide
						title="Select translation"
					>
						{#each globalState.getProjectTranslation.addedTranslationEditions as translation}
							<option value={translation.name}>{translation.author}</option>
						{/each}
					</select>
				</div>
			{:else}
				<p class="text-secondary text-sm mt-1 text-center">You have no translations yet.</p>
			{/if}
		{/if}

		<!-- search bar -->
		<div class="mt-1">
			<div class="relative">
				<span
					class="material-icons-outlined absolute left-2 top-1/2 -translate-y-1/2 text-secondary text-sm"
					>search</span
				>
				<input
					type="text"
					placeholder="Search styles..."
					class="w-full pl-10! pr-8 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] focus:ring-1 focus:ring-white/20"
					bind:value={globalState.getStylesState.searchQuery}
				/>
				{#if globalState.getStylesState.searchQuery}
					<button
						title="Clear search"
						onclick={clearSearch}
						class="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
					>
						<span class="material-icons-outlined text-sm">close</span>
					</button>
				{/if}
			</div>
		</div>

		<!-- Clips actuellement sélectionnés -->
		{#if globalState.getStylesState.selectedSubtitles.length > 0}
			<div
				class="mt-2 flex items-center justify-between bg-white/5 border border-[var(--border-color)] rounded-lg px-2 py-1"
			>
				<div class="flex items-center gap-2 text-secondary text-sm">
					<span class="material-icons-outlined text-base">select_all</span>
					<span>
						{globalState.getStylesState.selectedSubtitles.length} subtitle{globalState
							.getStylesState.selectedSubtitles.length > 1
							? 's'
							: ''} selected. Styles will only apply to these subtitles.
					</span>
				</div>
				<button
					class="btn px-2 py-1 rounded-md flex items-center gap-1"
					onclick={() => {
						globalState.getStylesState.clearSelection();
					}}
					title="Clear selection"
				>
					<span class="material-icons-outlined text-sm">backspace</span>
					<span class="text-sm">Clear</span>
				</button>
			</div>
		{/if}
	</div>
	<div
		class="flex flex-col gap-y-2 px-1 bg-[var(--bg-primary)]/60 rounded-xl border border-[var(--border-color)]/50 overflow-y-auto pb-10 rounded-t-none border-t-2 flex-1 py-1"
		bind:this={stylesContainer}
		onscroll={(e) => {
			globalState.currentProject!.projectEditorState.stylesEditor.scrollPosition =
				stylesContainer?.scrollTop || 0;
		}}
	>
		{#if globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedSubtitles.length > 0}
			<div
				class="mt-4 flex items-start gap-2 bg-amber-500/10 border border-amber-400/40 rounded-lg px-3 py-2 text-amber-200"
			>
				<span class="material-icons-outlined text-base mt-0.5">info</span>
				<p class="text-sm">
					You cannot edit global styles when clips are selected, because global styles apply to the
					entire video. Please clear your selection first.
				</p>
			</div>
		{:else}
			{#each getCategoriesToDisplay() as category}
				<Section
					name={category.name}
					icon={category.icon}
					contentClasses="border-x border-b border-[var(--border-color)] rounded-b-lg -mt-1 pt-1"
					classes="-mb-1 bg-white/10 pl-0.5 rounded-t-lg"
					dataCategory={globalState.getStylesState.currentSelection === 'translation'
						? globalState.getStylesState.currentSelectionTranslation
						: category.id}
				>
					{#each category.styles as style, styleIndex}
						{#if globalState.getStylesState.searchQuery === '' || style.name
								.toLowerCase()
								.includes(globalState.getStylesState.searchQuery.toLowerCase()) || category.name
								.toLowerCase()
								.includes(globalState.getStylesState.searchQuery.toLowerCase())}
							<!-- 
							Cas spécial : on ne peut pas avoir de séparateur entre le numéro de verset et le verset
							pour le texte Coranique, ni changer sa position. Empêche donc l'affichage de ces styles dans ce cas précis.
							
							Deuxième cas spécial : on ne veut pas pouvoir individuellement modifier les styles suivants:
								- show-subtitles
								- show-verse-number
								- show-decorative-brackets
								- verse-number-format
								- verse-number-position
								- max-height
							Empêche donc l'affichage de ces deux styles si on a une sélection de sous-titre en cours.

							Troisième cas :
							On empêche l'affichage du style "reactive-font-size" et "reactive-y-position" qui sont des styles utilitaire censé être non-visible. 
								  -->
							{#if !(globalState.getStylesState.currentSelection === 'arabic' && (style.id === 'verse-number-format' || style.id === 'verse-number-position')) && !(style.id === 'show-decorative-brackets' && globalState.getStylesState.currentSelection !== 'arabic') && !(globalState.getStylesState.selectedSubtitles.length > 0 && (style.id === 'show-subtitles' || style.id === 'show-verse-number' || style.id === 'show-decorative-brackets' || style.id === 'verse-number-format' || style.id === 'max-height' || style.id === 'verse-number-position')) && style.id !== 'reactive-font-size' && style.id !== 'reactive-y-position'}
								<!-- On veut désactiver certains style, comme par exemple
							 - Si on a le style "Always Show" pour les customs text d'enable, alors on disable les styles permettant
							 de set les propriétés de temps de début d'affichage et de fin d'affichage -->
								{@const toDisable =
									category.id.includes('custom-text') &&
									category.getStyle('always-show')?.value &&
									(style.id === 'time-appearance' || style.id === 'time-disappearance')}
								<!-- Si la recherche est vide ou si le nom du style correspond à la requête de recherche -->
								<StyleComponent
									{style}
									target={globalState.getStylesState.getCurrentSelection()}
									disabled={toDisable as boolean}
									applyValueSimple={(v) => {
										style.value = v;
									}}
								/>
							{/if}
						{/if}
					{/each}
				</Section>
			{/each}

			<!-- Ajoute maintenant les customs texts -->
			{#if globalState.getStylesState.currentSelection === 'global'}
				{#each globalState.getCustomClipTrack.clips as customTextClip, i}
					{@const category = (customTextClip as CustomTextClip).category!}
					<Section
						name={category.name}
						icon={category.icon}
						contentClasses="border-x border-b border-[var(--border-color)] rounded-b-lg -mt-1 pt-1"
						classes="-mb-1 bg-white/10 pl-0.5 rounded-t-lg"
					>
						{#each category.styles as style, styleIndex}
							{#if globalState.getStylesState.searchQuery === '' || style.name
									.toLowerCase()
									.includes(globalState.getStylesState.searchQuery.toLowerCase())}
								{@const toDisable =
									category.getStyle('always-show')!.value &&
									(style.id === 'time-appearance' || style.id === 'time-disappearance')}

								<!-- prettier-ignore -->
								<StyleComponent
								bind:style={
									category.styles[
										styleIndex
									]
								}
								applyValueSimple={(v) => {
									// Pour time-appearance et time-disappearance on modifie le clip lui-même
									// en plus du style. 
									if (style.id === 'time-appearance') {
										globalState.getCustomClipTrack.getCustomTextWithId(category.id)!.setStartTime(v);
									}
									if (style.id === 'time-disappearance') {
										globalState.getCustomClipTrack.getCustomTextWithId(category.id)!.setEndTime(v);
									}
									style.value = v;
								}}
								disabled={toDisable as boolean}
							/>
							{/if}
						{/each}
					</Section>
				{/each}
			{/if}
		{/if}

		{#if globalState.getStylesState.getCurrentSelection() === 'global'}
			<div class="grid grid-cols-2 mb-20 gap-x-1.5 mt-4 pr-2">
				<!-- Bouton pour ajouter un texte custom -->
				<button
					class="btn-accent mx-auto px-2 py-2 rounded-md flex items-center justify-center gap-1"
					onclick={async () => {
						await globalState.getVideoStyle.addCustomClip('text');
					}}
					title="Add custom text"
				>
					<span class="material-icons-outlined text-sm">add</span>
					Custom Text
				</button>
				<!-- Bouton pour ajouter un texte custom -->
				<button
					class="btn-accent mx-auto px-2 py-2 rounded-md flex items-center justify-center gap-1"
					onclick={async () => {
						await globalState.getVideoStyle.addCustomClip('image');
					}}
					title="Add custom text"
				>
					<span class="material-icons-outlined text-sm">add</span>
					Custom Image
				</button>
			</div>
		{/if}
	</div>
</div>
