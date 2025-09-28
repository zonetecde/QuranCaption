<script lang="ts">
	import { Edition, Project, ProjectContent, ProjectDetail, TrackType } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import SubtitleClip from '$lib/components/projectEditor/timeline/track/SubtitleClip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

	let { close } = $props();
	let selectedLanguage: string | null = $state(null);
	let selectedTranslations: Edition[] = $state([]);
	let searchQuery: string = $state('');
	let translationPreviews: Record<string, Record<string, string>> = $state({});
	let isLoadingPreview = $state(false);

	// Helper function to check if a translation is selected
	function isTranslationSelected(translation: Edition): boolean {
		return selectedTranslations.some((t) => t.name === translation.name);
	}

	// Toggle translation selection
	function toggleTranslationSelection(translation: Edition, language: string) {
		if (isTranslationSelected(translation)) {
			// Remove from selection
			selectedTranslations = selectedTranslations.filter((t) => t.name !== translation.name);
			delete translationPreviews[translation.name];
		} else {
			// Add to selection
			selectedTranslations = [...selectedTranslations, translation];
			selectedLanguage = language;
			// Load preview for this translation
			loadTranslationPreview(translation);
		}
	}

	// Load preview for a specific translation
	async function loadTranslationPreview(translation: Edition) {
		if (translationPreviews[translation.name]) return; // Already loaded

		isLoadingPreview = true;
		try {
			const preview =
				await globalState.currentProject!.content.projectTranslation.getAllProjectSubtitlesTranslations(
					translation
				);
			translationPreviews[translation.name] = preview;
		} catch (error) {
			translationPreviews[translation.name] = {};
		}
		isLoadingPreview = false;
	}

	// Computed filtered translations based on search
	const filteredTranslations = $derived(() => {
		if (!searchQuery) return globalState.availableTranslations;

		const filtered: any = {};
		const query = searchQuery.toLowerCase();

		for (const [language, data] of Object.entries(globalState.availableTranslations)) {
			if (language.toLowerCase().includes(query)) {
				filtered[language] = data;
			} else {
				const matchingTranslations = data.translations.filter((t: any) =>
					t.author.toLowerCase().includes(query)
				);

				if (matchingTranslations.length > 0) {
					filtered[language] = {
						...data,
						translations: matchingTranslations
					};
				}
			}
		}

		return filtered;
	});
	async function addTranslationButtonClick() {
		if (selectedTranslations.length > 0) {
			try {
				// Add all selected translations to the project in a single operation
				for (const translation of selectedTranslations) {
					const preview = translationPreviews[translation.name] || {};
					globalState.currentProject?.content.projectTranslation.addTranslation(
						translation,
						preview
					);
				}
				close();
			} catch (error) {
				toast.error('Failed to add translations to project');
				console.error('Error adding translations:', error);
			}
		}
	}

	let recentTranslations: Edition[] = $state([]);

	onMount(() => {
		// Récupère les éditions de traduction des 10 derniers projets ouverts (pour avoir des traductions récentes)
		const recentProjects = globalState.userProjectsDetails
			.filter((p) => p.updatedAt)
			.sort((a, b) => b.updatedAt!.getTime() - a.updatedAt!.getTime())
			.slice(0, 10);

		const recentEditionsSet = new Set<string>();
		for (const projectDetail of recentProjects) {
			if (projectDetail.id === globalState.currentProject?.detail.id) continue; // Skip current project

			for (const editionName of Object.keys(projectDetail.translations)) {
				console.log('Found recent edition:', editionName);
				if (!recentEditionsSet.has(editionName)) {
					const edition = globalState.getEditionFromAuthor(editionName);
					if (edition) {
						recentTranslations.push(edition);
						recentEditionsSet.add(editionName);
					}
				}
			}
		}
	});
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[800px] h-[700px] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
>
	<!-- Header with gradient background -->
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">translate</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">Add Translation</h2>
					<p class="text-sm text-thirdly">
						Choose a language and translation to add to your project
					</p>
				</div>
			</div>

			<!-- Close button -->
			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>
	<!-- Search bar -->
	<div class="px-6 py-4 border-b border-color bg-primary">
		<div class="relative">
			<input
				type="text"
				placeholder="Search languages or authors..."
				bind:value={searchQuery}
				class="w-full pr-4 py-3 bg-secondary border border-color rounded-xl text-primary focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-opacity-20 transition-all duration-200"
				style="padding-left: 40px; "
			/>

			<span class="material-icons absolute left-3 top-1/2 transform -translate-y-1/2 text-thirdly"
				>search</span
			>
		</div>

		<!-- Recent translations section -->
		{#if recentTranslations.length > 0 && !searchQuery}
			<div class="mt-4">
				<div class="flex items-center gap-2 mb-2">
					<span class="material-icons text-accent-primary text-sm">history</span>
					<span class="text-sm font-medium text-primary">Recent Translations</span>
				</div>
				<div class="flex flex-wrap gap-2">
					{#each recentTranslations.slice(0, 8) as translation}
						{@const isSelected = isTranslationSelected(translation)}
						<button
							class="px-3 py-1.5 text-xs bg-secondary border border-color rounded-lg hover:border-accent-primary transition-all duration-200 flex items-center gap-1.5
							       {isSelected ? 'border-accent-primary bg-[rgba(88,166,255,0.1)]' : ''}"
							onclick={() => {
								const languageKey = Object.keys(globalState.availableTranslations).find((lang) =>
									globalState.availableTranslations[lang].translations.some(
										(t) => t.name === translation.name
									)
								);
								if (languageKey) {
									toggleTranslationSelection(translation, languageKey);
								}
							}}
						>
							{#if isSelected}
								<span class="material-icons text-accent-primary" style="font-size: 12px;"
									>check_circle</span
								>
							{:else}
								<span class="material-icons text-thirdly opacity-50" style="font-size: 12px;"
									>add_circle_outline</span
								>
							{/if}
							<span class="text-primary font-medium">{translation.author}</span>
						</button>
					{/each}
					{#if recentTranslations.length > 8}
						<span class="px-2 py-1.5 text-xs text-thirdly bg-accent rounded-lg border border-color">
							+{recentTranslations.length - 8} more
						</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>
	<!-- Content area -->
	<div class="flex-1 overflow-hidden">
		{#if selectedTranslations.length > 0}
			<!-- Two column layout: Selection + Preview -->
			<div class="h-full flex">
				<!-- Left column: Selection -->
				<div class="w-1/2 border-r border-color overflow-y-auto px-6 py-4">
					<div class="mb-4">
						<h3 class="text-lg font-semibold text-primary mb-2">Available Translations</h3>
						<p class="text-sm text-thirdly">
							{selectedTranslations.length} translation{selectedTranslations.length > 1 ? 's' : ''} selected
						</p>
					</div>

					<div class="space-y-4">
						{#each Object.keys(filteredTranslations()) as language}
							{@const translationFlag = filteredTranslations()[language].flag}
							{@const translations = filteredTranslations()[language].translations}

							<!-- Language section -->
							<div class="bg-accent border border-color rounded-lg overflow-hidden">
								<!-- Language header -->
								<div
									class="flex items-center gap-3 p-3 bg-gradient-to-r from-bg-secondary to-bg-accent border-b border-color"
								>
									<img src={translationFlag} alt={language} class="w-6 h-6 shadow-lg" />
									<div>
										<h4 class="font-semibold text-primary">{language}</h4>
										<p class="text-xs text-thirdly">{translations.length} available</p>
									</div>
								</div>

								<!-- Translations -->
								<div class="p-3 space-y-2">
									{#each translations as translationDetail}
										{@const isSelected = isTranslationSelected(translationDetail)}
										<button
											class="w-full p-3 bg-secondary border border-color rounded-lg hover:border-accent-primary transition-all duration-200 text-left
											       {isSelected ? 'border-accent-primary bg-[rgba(88,166,255,0.1)]' : ''}"
											onclick={() => toggleTranslationSelection(translationDetail, language)}
										>
											<div class="flex items-center justify-between">
												<div class="flex items-center gap-2">
													{#if translationDetail.comments === 'Ponctuation' || translationDetail.comments === 'Saheeh International'}
														<span class="material-icons text-yellow-200 text-sm">star</span>
													{/if}
													<span class="font-medium text-primary text-sm"
														>{translationDetail.author}</span
													>
												</div>
												{#if isSelected}
													<span class="material-icons text-accent-primary text-sm"
														>check_circle</span
													>
												{:else}
													<span class="material-icons text-thirdly text-sm opacity-50"
														>radio_button_unchecked</span
													>
												{/if}
											</div>
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Right column: Preview -->
				<div class="w-1/2 overflow-y-auto px-6 py-4">
					<div class="mb-4">
						<h3 class="text-lg font-semibold text-primary mb-2">Translation Previews</h3>
						<p class="text-sm text-thirdly">
							Preview of selected translations for your project verses
						</p>
					</div>

					{#if isLoadingPreview}
						<!-- Loading state -->
						<div class="flex items-center justify-center py-12">
							<div class="text-center">
								<div
									class="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
								></div>
								<p class="text-sm text-thirdly">Loading translation preview...</p>
							</div>
						</div>
					{:else if selectedTranslations.length === 0}
						<!-- Empty state -->
						<div class="flex items-center justify-center py-12">
							<div class="text-center">
								<div
									class="w-12 h-12 bg-accent rounded-full flex items-center justify-center mb-3 mx-auto"
								>
									<span class="material-icons text-thirdly">translate</span>
								</div>
								<p class="text-sm text-thirdly">Select translations to see preview</p>
							</div>
						</div>{:else if selectedTranslations.length === 1}
						<!-- Single translation - Full preview -->
						{@const translation = selectedTranslations[0]}
						{@const preview = translationPreviews[translation.name] || {}}

						<div class="mb-4">
							<div class="flex items-center gap-2 mb-2">
								<span class="material-icons text-accent-primary text-sm">translate</span>
								<h4 class="font-medium text-primary">{translation.author}</h4>
							</div>
						</div>

						{#if Object.keys(preview).length === 0}
							<div class="flex items-center justify-center py-12">
								<div class="text-center">
									<div
										class="w-12 h-12 bg-accent rounded-full flex items-center justify-center mb-3 mx-auto"
									>
										<span class="material-icons text-thirdly">translate</span>
									</div>
									<p class="text-sm text-thirdly">No verses found for this translation</p>
								</div>
							</div>
						{:else}
							<!-- Full translation preview -->
							<div class="space-y-3">
								{#each Object.entries(preview) as [verseKey, translationText]}
									{@const [surah, verse] =
										verseKey.split(':').length === 2 ? verseKey.split(':') : [null, null]}
									<div
										class="bg-secondary border border-color rounded-lg p-4 hover:border-accent-primary transition-all duration-200"
									>
										<!-- Verse reference -->
										<div class="flex items-center gap-2 mb-2">
											<span
												class="bg-accent-primary text-black px-2 py-1 rounded-md text-xs font-semibold"
											>
												{verseKey}
											</span>
											{#if surah && verse}
												<span class="text-xs text-thirdly">Surah {surah}, Verse {verse}</span>
											{/if}
										</div>

										<!-- Translation text -->
										<p class="text-sm text-primary leading-relaxed">{translationText}</p>
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<!-- Multiple translations - Condensed preview showing first 3 verses max per translation -->
						<div class="space-y-4">
							{#each selectedTranslations as translation}
								{@const preview = translationPreviews[translation.name] || {}}
								<div class="border border-color rounded-lg p-4 bg-secondary">
									<div class="flex items-center gap-2 mb-3">
										<span class="material-icons text-accent-primary text-sm">translate</span>
										<h4 class="font-medium text-primary">{translation.author}</h4>
										{#if Object.keys(preview).length > 0}
											<span class="text-xs text-thirdly bg-accent px-2 py-1 rounded">
												{Object.keys(preview).length} verses
											</span>
										{/if}
									</div>

									{#if Object.keys(preview).length === 0}
										<p class="text-xs text-thirdly italic">Loading preview...</p>
									{:else}
										<!-- Show max 3 verses per translation in condensed mode -->
										<div class="space-y-2">
											{#each Object.entries(preview).slice(0, 3) as [verseKey, translationText]}
												<div class="bg-accent rounded p-3 border border-color">
													<div class="flex items-center gap-2 mb-2">
														<span
															class="bg-accent-primary text-black px-2 py-1 rounded text-xs font-semibold"
														>
															{verseKey}
														</span>
													</div>
													<!-- Truncate long texts in condensed mode -->
													<p class="text-xs text-primary leading-relaxed line-clamp-2">
														{translationText.length > 120
															? translationText.substring(0, 120) + '...'
															: translationText}
													</p>
												</div>
											{/each}
											{#if Object.keys(preview).length > 3}
												<div class="text-center">
													<span class="text-xs text-thirdly bg-bg-secondary px-3 py-1 rounded-full">
														+{Object.keys(preview).length - 3} more verses
													</span>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<!-- Original single column layout when no translation selected -->
			<div class="h-full overflow-y-auto px-6 py-4 space-y-4">
				{#if Object.keys(filteredTranslations()).length === 0}
					<!-- Empty state -->
					<div class="flex flex-col items-center justify-center h-full text-center">
						<div class="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4">
							<span class="material-icons text-thirdly text-2xl">search_off</span>
						</div>
						<h3 class="text-lg font-semibold text-primary mb-2">No translations found</h3>
						<p class="text-thirdly max-w-md">
							{#if searchQuery}
								No translations match your search "{searchQuery}". Try a different search term.
							{:else}
								No translations are currently available.
							{/if}
						</p>
						{#if searchQuery}
							<button class="btn mt-4 px-4 py-2" onclick={() => (searchQuery = '')}>
								Clear search
							</button>
						{/if}
					</div>
				{:else}
					{#each Object.keys(filteredTranslations()) as language}
						{@const translationFlag = filteredTranslations()[language].flag}
						{@const translations = filteredTranslations()[language].translations}

						<!-- Language section -->
						<div class="bg-accent border border-color rounded-xl overflow-hidden">
							<!-- Language header -->
							<div
								class="flex items-center gap-3 p-4 bg-gradient-to-r from-bg-secondary to-bg-accent border-b border-color"
							>
								<div class="relative">
									<img src={translationFlag} alt={language} class="w-8 h-8 shadow-lg" />
								</div>
								<div>
									<h3 class="font-bold text-lg text-primary">{language}</h3>
									<p class="text-sm text-thirdly">
										{translations.length} translation{translations.length > 1 ? 's' : ''} available
									</p>
								</div>
							</div>

							<!-- Translations grid -->
							<div class="p-4">
								<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
									{#each translations as translationDetail}
										{@const isSelected = isTranslationSelected(translationDetail)}
										<button
											class="group relative p-4 bg-secondary border border-color rounded-lg hover:border-accent-primary hover:bg-[rgba(88,166,255,0.05)] transition-all duration-200 text-left cursor-pointer
											       {isSelected ? 'border-accent-primary bg-[rgba(88,166,255,0.1)]' : ''}"
											onclick={() => toggleTranslationSelection(translationDetail, language)}
										>
											<!-- Selection indicator -->
											<div
												class="absolute top-2 right-2 w-5 h-5 rounded-full border-2 border-accent-primary flex items-center justify-center transition-all duration-200
												       {isSelected
													? 'bg-accent-primary'
													: 'group-hover:bg-accent-primary group-hover:bg-opacity-20'}"
											>
												{#if isSelected}
													<span class="material-icons text-black text-xs">check</span>
												{/if}
											</div>

											<!-- Content -->
											<div class="pr-8 cursor-pointer">
												<h4
													class="font-semibold text-primary group-hover:text-accent-primary transition-colors duration-200 flex items-center"
												>
													{#if translationDetail.comments === 'Ponctuation' || translationDetail.comments === 'Saheeh International'}
														<!-- star icon -->
														<span class="material-icons text-yellow-200 text-xs mr-1">star</span>
													{/if}
													{translationDetail.author}
												</h4>
											</div>

											<!-- Hover effect -->
											<div
												class="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent to-accent-primary opacity-0 group-hover:opacity-5 transition-opacity duration-200 cursor-pointer"
											></div>
										</button>
									{/each}
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
	<!-- Footer with action buttons -->
	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				{#if selectedTranslations.length > 0}
					<span class="material-icons text-accent-secondary">check_circle</span>
					<span>
						Selected: <strong class="text-accent-primary">{selectedTranslations.length}</strong>
						translation{selectedTranslations.length > 1 ? 's' : ''}
						{#if selectedTranslations.length === 1}
							(<strong class="text-accent-primary">{selectedTranslations[0].author}</strong>)
						{/if}
					</span>
				{:else}
					<span class="material-icons">info</span>
					<span>Please select one or more translations to continue</span>
				{/if}
			</div>

			<div class="flex gap-3">
				<button class="btn px-6 py-2.5 font-medium" onclick={close}> Cancel </button>
				<button
					class="btn-accent px-6 py-2.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					onclick={addTranslationButtonClick}
					disabled={selectedTranslations.length === 0}
				>
					<span class="material-icons text-lg">add</span>
					Add Translation{selectedTranslations.length > 1 ? 's' : ''}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Custom scrollbar */
	.overflow-y-auto::-webkit-scrollbar {
		width: 8px;
	}

	.overflow-y-auto::-webkit-scrollbar-track {
		background: var(--bg-secondary);
		border-radius: 4px;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: var(--timeline-scrollbar);
		border-radius: 4px;
		transition: background 0.2s ease;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb:hover {
		background: var(--timeline-scrollbar-hover);
	}
	/* Line clamp utility for text truncation */
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Smooth animations */
	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.bg-secondary {
		animation: slideInUp 0.3s ease-out;
	}

	/* Enhanced gradient backgrounds */
	.bg-gradient-to-r.from-accent.to-bg-accent {
		background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%);
	}

	.bg-gradient-to-r.from-bg-secondary.to-bg-accent {
		background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-accent) 100%);
	}

	/* Enhanced hover effects */
	button:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.btn-accent:hover {
		box-shadow: 0 4px 16px rgba(88, 166, 255, 0.3);
	}

	/* Flag image enhancements */
	img[alt] {
		object-fit: cover;
		transition: transform 0.2s ease;
	}

	img[alt]:hover {
		transform: scale(1.1);
	}

	/* Selection indicator animation */
	.group:hover .absolute.top-2.right-2 {
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	/* Enhanced focus states */
	input:focus {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(88, 166, 255, 0.2);
	}

	/* Better disabled state */
	button:disabled {
		transform: none !important;
		box-shadow: none !important;
	}
</style>
