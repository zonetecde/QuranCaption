<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import Section from '../../Section.svelte';
	import StyleComponent from './Style.svelte';
	import ImportExportStyle from './ImportExportStyle.svelte';
	import { slide } from 'svelte/transition';
	import { CustomTextClip } from '$lib/classes';
	import type { VisualMergeMode } from '$lib/classes/Clip.svelte';
	import {
		canMergeArabicVisualModes,
		getActiveVisualMergeGroupId,
		getActiveVisualMergeMode
	} from './visualMergeStyleUtils';

	const getCategoriesToDisplay = $derived(() => {
		const target = globalState.getStylesState.getCurrentSelection();
		const categories = globalState.getVideoStyle.getStylesOfTarget(target).categories;

		// Quand des clips vidéo sont sélectionnés dans l'onglet Style,
		// on n'affiche que la catégorie Overlay côté global.
		if (target === 'global' && globalState.getStylesState.selectedVideos.length > 0) {
			return categories.filter((category) => category.id === 'overlay');
		}

		return categories;
	});

	let stylesContainer: HTMLDivElement | undefined;
	let importExportMenuVisible = $state(false);

	const visualMergeSelection = $derived(() =>
		globalState.getSubtitleTrack.getVisualMergeSelection(
			globalState.getStylesState.selectedSubtitles
		)
	);

	const activeVisualMergeMode = $derived(() => {
		return getActiveVisualMergeMode(
			globalState.getStylesState.selectedSubtitles,
			globalState.getSubtitleTrack
		);
	});

	const activeVisualMergeGroupId = $derived(() => {
		return getActiveVisualMergeGroupId(
			globalState.getStylesState.selectedSubtitles,
			activeVisualMergeMode()
		);
	});

	const canMergeArabicModes = $derived(() => {
		return canMergeArabicVisualModes(visualMergeSelection(), globalState.getSubtitleTrack);
	});

	onMount(async () => {
		// Assure la présence des nouveaux styles ajoutés par les updates.
		await globalState.getVideoStyle.ensureStylesSchemaUpToDate();

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
	 * Applique un merge visuel sur la selection courante.
	 * @param {VisualMergeMode} mode Mode de merge choisi.
	 * @returns {void}
	 */
	function applyVisualMerge(mode: VisualMergeMode): void {
		globalState.getSubtitleTrack.applyVisualMerge(
			globalState.getStylesState.selectedSubtitles,
			mode
		);
	}

	/**
	 * Retourne la classe du bouton de merge selon le mode actif.
	 * @param {VisualMergeMode} mode Mode represente par le bouton.
	 * @returns {string} Classes CSS a appliquer.
	 */
	function getMergeButtonClass(mode: VisualMergeMode): string {
		return (
			'py-1.5 2xl:text-sm text-xs 2xl:px-2 ' +
			(activeVisualMergeMode() === mode ? 'btn-accent' : 'btn')
		);
	}

	/**
	 * Retire le merge visuel du groupe actuellement selectionne.
	 * @returns {void}
	 */
	function unmergeSelectedVisualGroup(): void {
		const groupId = activeVisualMergeGroupId();
		if (!groupId) return;
		globalState.getSubtitleTrack.unmergeVisualGroup(groupId);
	}

	/**
	 * Bascule l'affichage du menu de presets de style
	 */
	function toggleImportExportMenu() {
		importExportMenuVisible = !importExportMenuVisible;
	}

	// Fermer le menu en cliquant à l'extérieur
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (
			!target.closest('.import-export-menu') &&
			!target.closest('.import-export-button') &&
			!target.closest('.style-preset-modal')
		) {
			importExportMenuVisible = false;
		}
	}

	/**
	 * Désactive les styles de timing (appearance/disappearance) des overlays globaux
	 * `surah-name` et `reciter-name` lorsque leur style `*-always-show` vaut `true`.
	 */
	function isGlobalTimedOverlayStyleDisabled(categoryId: string, styleId: string): boolean {
		const alwaysShowStyleId =
			categoryId === 'surah-name'
				? 'surah-name-always-show'
				: categoryId === 'reciter-name'
					? 'reciter-name-always-show'
					: null;

		const isTimingStyle =
			(categoryId === 'surah-name' &&
				(styleId === 'surah-name-time-appearance' ||
					styleId === 'surah-name-time-disappearance')) ||
			(categoryId === 'reciter-name' &&
				(styleId === 'reciter-name-time-appearance' ||
					styleId === 'reciter-name-time-disappearance'));

		if (!alwaysShowStyleId || !isTimingStyle) return false;
		return Boolean(globalState.getStyle('global', alwaysShowStyleId).value);
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
	<div class="flex gap-x-2 items-center px-3 mb-2 mt-4 style-editor-header-row">
		<span class="material-icons-outlined text-accent text-2xl">auto_fix_high</span>
		<h2 class="text-xl font-semibold text-primary tracking-wide">Style Editor</h2>

		<div class="relative ml-auto">
			<button
				class="import-export-button btn-accent flex flex-row items-center px-2 py-1 gap-x-2 text-sm"
				onclick={toggleImportExportMenu}
			>
				<span class="material-icons-outlined text-[20px]!">style</span>Presets
			</button>
			<ImportExportStyle bind:isVisible={importExportMenuVisible} />
		</div>
	</div>

	<div
		class="flex flex-col px-3 py-3 bg-[var(--bg-primary)]/60 border border-b-0 rounded-b-none border-[var(--border-color)]/50 rounded-xl gap-y-2 style-editor-top-controls"
	>
		<p class="text-sm text-secondary style-editor-target-label">Choose a target</p>
		<div data-tour-id="style-subtabs" class="w-full grid grid-cols-3 gap-2">
			{#each ['global', 'arabic', 'translation'] as selection (selection)}
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
						{#each globalState.getProjectTranslation.addedTranslationEditions as translation (translation.name)}
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
					<span class="style-selection-count-label">
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

			{#if visualMergeSelection() && canMergeArabicModes()}
				<div class="rounded-lg border border-emerald-400/30 bg-emerald-500/8 px-3 py-2">
					<div class="flex items-start gap-2 text-sm text-[var(--text-primary)]">
						<span class="material-icons-outlined text-base mt-0.5">merge_type</span>
						<div class="flex-1">
							<p class="font-medium">Visual merge</p>
							<p class="mt-0.5 text-xs leading-relaxed text-secondary visual-merge-description">
								Merge only the on-screen rendering.
							</p>
						</div>
					</div>

					<div class="mt-2 grid grid-cols-3 gap-2">
						<button
							data-testid="Merge Arabic"
							class={getMergeButtonClass('arabic')}
							onclick={() => applyVisualMerge('arabic')}
						>
							Arabic
						</button>
						<button
							data-testid="Merge Translation"
							class={getMergeButtonClass('translation')}
							onclick={() => applyVisualMerge('translation')}
						>
							Translation
						</button>
						<button
							data-testid="Merge Both"
							class={getMergeButtonClass('both')}
							onclick={() => applyVisualMerge('both')}
						>
							Both
						</button>
					</div>

					{#if activeVisualMergeGroupId()}
						<button
							class="btn mt-2 w-full py-1.5 2xl:text-sm text-xs"
							onclick={unmergeSelectedVisualGroup}
						>
							Unmerge Group
						</button>
					{/if}
				</div>
			{/if}
		{/if}

		{#if globalState.getStylesState.selectedVideos.length > 0}
			<div
				class="mt-2 flex items-center justify-between bg-white/5 border border-[var(--border-color)] rounded-lg px-2 py-1"
			>
				<div class="flex items-center gap-2 text-secondary text-sm">
					<span class="material-icons-outlined text-base">movie</span>
					<span class="style-selection-count-label">
						{globalState.getStylesState.selectedVideos.length} video clip{globalState.getStylesState
							.selectedVideos.length > 1
							? 's'
							: ''} selected. Overlay styles will apply only to these clips.
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

		{#if globalState.getStylesState.selectedSubtitles.length <= 1}
			<div
				class="mt-2 flex items-start gap-2 rounded-lg border border-sky-400/35 bg-sky-500/8 px-2 py-1.5 text-[var(--text-primary)] style-selection-hint-box"
			>
				<span class="material-icons-outlined text-base mt-0.5">info</span>
				<p class="text-xs leading-relaxed style-selection-hint-label">
					Click a subtitle or a video clip to select only it. Press <span class="font-semibold"
						>Ctrl + Left Click</span
					> to select multiple clips.
				</p>
			</div>
		{/if}
	</div>
	<div
		class="flex flex-col gap-y-2 px-1 bg-[var(--bg-primary)]/60 rounded-xl border border-[var(--border-color)]/50 overflow-y-auto pb-10 rounded-t-none border-t-2 flex-1 py-1"
		bind:this={stylesContainer}
		onscroll={(_e) => {
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
					You cannot edit global styles when subtitle clips are selected, because global styles
					apply to the entire video. Please clear your selection first.
				</p>
			</div>
		{:else}
			{#each getCategoriesToDisplay() as category (category.id)}
				<Section
					name={category.name}
					icon={category.icon}
					contentClasses="border-x border-b border-[var(--border-color)] rounded-b-lg -mt-1 pt-1"
					classes="-mb-1 bg-white/10 pl-0.5 rounded-t-lg"
					dataCategory={globalState.getStylesState.currentSelection === 'translation'
						? globalState.getStylesState.currentSelectionTranslation
						: category.id}
				>
					{#if category.id === 'background'}
						<div
							class="mx-2 mb-2 flex items-start gap-2 rounded-md border border-sky-400/35 bg-sky-500/8 px-2 py-1.5 translate-y-1.5 text-[var(--text-primary)]"
						>
							<span
								class="material-icons-outlined text-sm mt-0.5"
								title="Background is visible only when 'Max Height' style is set.">info</span
							>
							<p class="text-xs leading-relaxed">
								Background is visible only when <span class="font-semibold">Max Height</span> style
								is
								<span class="font-semibold">set</span>.
							</p>
						</div>
					{/if}

					{#each category.styles as style (style.id)}
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
								- mushaf-style
								- text-direction
								- decorative-brackets-font-family
								- verse-number-format
								- verse-number-position
								- max-height
							Empêche donc l'affichage de ces deux styles si on a une sélection de sous-titre en cours.

							Troisième cas :
							On empêche l'affichage du style "reactive-font-size" et "reactive-y-position" qui sont des styles utilitaire censé être non-visible. 

							Quatrième cas :
							On empêche la modification du font-family style si on a pas "Uthmani" de sélectionné pour le style du mushaf, car Indopak et Tajweed ont des fonts spécifique
								  -->
							{#if !(globalState.getStylesState.currentSelection === 'arabic' && (style.id === 'verse-number-format' || style.id === 'verse-number-position' || style.id === 'text-direction')) && !(style.id === 'show-decorative-brackets' && globalState.getStylesState.currentSelection !== 'arabic') && !(style.id === 'decorative-brackets-font-family' && globalState.getStylesState.currentSelection !== 'arabic') && !(style.id === 'mushaf-style' && globalState.getStylesState.currentSelection !== 'arabic') && !(globalState.getStylesState.currentSelection === 'arabic' && style.id === 'font-family' && globalState.getStyle('arabic', 'mushaf-style')?.value !== 'Uthmani') && !(style.id === 'decorative-brackets-font-family' && !globalState.getStyle('arabic', 'show-decorative-brackets').value) && !(globalState.getStylesState.selectedSubtitles.length > 0 && (style.id === 'show-subtitles' || style.id === 'show-verse-number' || style.id === 'show-decorative-brackets' || style.id === 'mushaf-style' || style.id === 'decorative-brackets-font-family' || style.id === 'verse-number-format' || style.id === 'max-height' || style.id === 'verse-number-position' || style.id === 'text-direction')) && style.id !== 'reactive-font-size' && style.id !== 'reactive-y-position'}
								<!-- On veut désactiver certains style, comme par exemple
							 - Si on a le style "Always Show" pour les customs text d'enable, alors on disable les styles permettant
							 de set les propriétés de temps de début d'affichage et de fin d'affichage -->
								{@const toDisable =
									(category.id.includes('custom-text') &&
										category.getStyle('always-show')?.value &&
										(style.id === 'time-appearance' || style.id === 'time-disappearance')) ||
									isGlobalTimedOverlayStyleDisabled(category.id, style.id)}
								<!-- Si la recherche est vide ou si le nom du style correspond à la requête de recherche -->
								<StyleComponent
									{style}
									target={globalState.getStylesState.getCurrentSelection()}
									disabled={toDisable as boolean}
									applyValueSimple={(v) => {
										style.value = v as typeof style.value;
									}}
								/>
							{/if}
						{/if}
					{/each}
				</Section>
			{/each}

			<!-- Ajoute maintenant les customs texts -->
			{#if globalState.getStylesState.currentSelection === 'global' && globalState.getStylesState.selectedVideos.length === 0}
				{#each globalState.getCustomClipTrack.clips as customTextClip (customTextClip.id)}
					{@const category = (customTextClip as CustomTextClip).category!}
					<Section
						name={category.name}
						icon={category.icon}
						contentClasses="border-x border-b border-[var(--border-color)] rounded-b-lg -mt-1 pt-1"
						classes="-mb-1 bg-white/10 pl-0.5 rounded-t-lg"
					>
						{#each category.styles as style (style.id)}
							{#if globalState.getStylesState.searchQuery === '' || style.name
									.toLowerCase()
									.includes(globalState.getStylesState.searchQuery.toLowerCase())}
								{@const toDisable =
									category.getStyle('always-show')!.value &&
									(style.id === 'time-appearance' || style.id === 'time-disappearance')}

								<!-- prettier-ignore -->
								<StyleComponent
								{style}
								applyValueSimple={(v) => {
									const targetCustomClip = globalState.getCustomClipTrack.getCustomClipWithId(
										category.id
									);
									if (!targetCustomClip) {
										style.value = v as typeof style.value;
										return;
									}

									// Harmonise begin/end pour éviter un état clip/style incoherent.
									if (style.id === 'time-appearance' && typeof v === 'number') {
										const endStyle = category.getStyle('time-disappearance');
										const currentEnd = Number(endStyle?.value ?? 0);

										if (v > currentEnd) {
											const endFallback = v + 3000;
											if (endStyle) endStyle.value = endFallback;
											targetCustomClip.setEndTime(endFallback);
										}

										targetCustomClip.setStartTime(v);
										style.value = v as typeof style.value;
										return;
									}

									if (style.id === 'time-disappearance' && typeof v === 'number') {
										const beginStyle = category.getStyle('time-appearance');
										const currentBegin = Number(beginStyle?.value ?? 0);

										if (v < currentBegin) {
											const endFallback = v + 3000;
											if (beginStyle) beginStyle.value = v;
											targetCustomClip.setStartTime(v);
											targetCustomClip.setEndTime(endFallback);
											style.value = endFallback as typeof style.value;
											return;
										}

										targetCustomClip.setEndTime(v);
										style.value = v as typeof style.value;
										return;
									}

									style.value = v as typeof style.value;
								}}
								disabled={toDisable as boolean}
							/>
							{/if}
						{/each}
					</Section>
				{/each}
			{/if}
		{/if}

		{#if globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedVideos.length === 0}
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

<style>
	@media (max-width: 1440px) {
		.style-selection-count-label,
		.style-selection-hint-label {
			font-size: 0.625rem;
			line-height: 1.1;
		}
	}

	@media (max-height: 780px), (max-width: 420px) {
		.style-editor-target-label,
		.visual-merge-description,
		.style-selection-hint-box {
			display: none;
		}

		.style-selection-count-label {
			display: -webkit-box;
			-webkit-line-clamp: 1;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}

		.style-editor-header-row {
			margin-top: 0.5rem;
			margin-bottom: 0.25rem;
		}

		.style-editor-top-controls {
			padding-top: 0.5rem;
			padding-bottom: 0.5rem;
			gap: 0.375rem;
		}
	}
</style>
