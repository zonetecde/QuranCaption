<script lang="ts">
	import { onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { Edition } from '$lib/classes';
	import {
		QdcTranslationService,
		type TranslationLanguageData
	} from '$lib/services/QdcTranslationService';

	type MockModel = { provider: string; model: string; label: string };

	// TODO: Replace with real video generation providers/models when integrating real APIs
	const MOCK_MODELS: MockModel[] = [
		{
			provider: 'Mock Provider',
			model: 'cinematic-nature',
			label: 'Mock Provider / Cinematic Nature'
		},
		{ provider: 'Mock Provider', model: 'abstract-light', label: 'Mock Provider / Abstract Light' },
		{ provider: 'Mock Provider', model: 'rainy-sky', label: 'Mock Provider / Rainy Sky' }
	];

	type Resolution = 'portrait' | 'landscape';
	type BackgroundSourceMode = 'ai' | 'youtube';
	type AvailableTranslationsMap = Record<string, TranslationLanguageData>;

	let {
		sourceMode = $bindable<BackgroundSourceMode>('ai'),
		selectedModel = $bindable(MOCK_MODELS[0].label),
		resolution = $bindable<Resolution>('portrait'),
		letAiChoose = $bindable(true),
		selectedTranslation = $bindable<Edition | null>(null)
	} = $props();

	let translationSearchQuery = $state('');
	let isTranslationDropdownOpen = $state(false);
	let isLoadingQdc = $state(false);
	let activeTab = $state<'quran-api' | 'quran-com-api'>('quran-api');

	// Load QDC translations on mount if not already loaded
	onMount(async () => {
		if (Object.keys(globalState.qdcAvailableTranslations).length === 0) {
			isLoadingQdc = true;
			try {
				const qdcTranslations = await QdcTranslationService.getAvailableTranslations(
					globalState.availableTranslations as AvailableTranslationsMap
				);
				globalState.qdcAvailableTranslations = qdcTranslations;
			} catch (error) {
				console.error('Failed to load QDC translations:', error);
			} finally {
				isLoadingQdc = false;
			}
		}
	});

	// Active translations map based on tab
	let activeTranslationsMap = $derived.by((): AvailableTranslationsMap => {
		return activeTab === 'quran-api'
			? (globalState.availableTranslations as AvailableTranslationsMap)
			: (globalState.qdcAvailableTranslations as AvailableTranslationsMap);
	});

	// Filtered translations by search query
	let filteredTranslationsMap = $derived.by((): AvailableTranslationsMap => {
		const map = activeTranslationsMap;
		if (!translationSearchQuery) return map;

		const query = translationSearchQuery.toLowerCase();
		const filtered: AvailableTranslationsMap = {};

		for (const [language, data] of Object.entries(map)) {
			if (language.toLowerCase().includes(query)) {
				filtered[language] = data;
				continue;
			}
			const matchingTranslations = data.translations.filter(
				(t) => t.author.toLowerCase().includes(query) || t.name.toLowerCase().includes(query)
			);
			if (matchingTranslations.length > 0) {
				filtered[language] = { ...data, translations: matchingTranslations };
			}
		}

		return filtered;
	});

	function selectTranslation(edition: Edition) {
		selectedTranslation = edition;
		isTranslationDropdownOpen = false;
		translationSearchQuery = '';
	}

	function clearTranslation() {
		selectedTranslation = null;
	}
</script>

<svelte:window
	onclick={(e) => {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-translation-picker]')) {
			isTranslationDropdownOpen = false;
		}
	}}
/>

<div class="space-y-5">
	{#if sourceMode === 'ai'}
		<!-- Provider / Model -->
		<div class="space-y-2">
			<label for="ai-model" class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">smart_toy</span>
				Provider / Model
			</label>
			<select
				id="ai-model"
				bind:value={selectedModel}
				class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary shadow-inner"
			>
				{#each MOCK_MODELS as model (model.label)}
					<option value={model.label}>{model.label}</option>
				{/each}
			</select>
			<p class="text-xs text-thirdly">Mocked providers for now. Real APIs will be added later.</p>
		</div>

		<!-- Resolution -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">aspect_ratio</span>
				Resolution
			</span>
			<div class="flex gap-3">
				<button
					type="button"
					class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {resolution ===
					'portrait'
						? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
						: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
					onclick={() => (resolution = 'portrait')}
				>
					<span class="material-icons text-base align-middle mr-1">stay_current_portrait</span>
					Portrait (9:16)
				</button>
				<button
					type="button"
					class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {resolution ===
					'landscape'
						? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
						: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
					onclick={() => (resolution = 'landscape')}
				>
					<span class="material-icons text-base align-middle mr-1">stay_current_landscape</span>
					Landscape (16:9)
				</button>
			</div>
		</div>
	{/if}

	<!-- Translation selector -->
	<div class="space-y-2" data-translation-picker>
		<span class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">translate</span>
			Translation
		</span>

		{#if selectedTranslation}
			<!-- Selected translation chip -->
			<div
				class="flex items-center justify-between rounded-xl border border-accent-primary bg-accent-primary/10 px-4 py-3"
			>
				<div class="flex items-center gap-2 min-w-0">
					<span class="material-icons text-accent-primary text-sm">check_circle</span>
					<span class="text-sm text-primary font-medium truncate">{selectedTranslation.author}</span
					>
					<span class="text-xs text-thirdly shrink-0">({selectedTranslation.language})</span>
				</div>
				<button
					type="button"
					class="ml-2 text-secondary hover:text-primary transition-colors cursor-pointer shrink-0"
					onclick={clearTranslation}
				>
					<span class="material-icons text-base">close</span>
				</button>
			</div>
		{:else}
			<!-- Search input to open dropdown -->
			<button
				type="button"
				class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-sm text-thirdly text-left hover:border-accent-primary/50 transition-all cursor-pointer flex items-center justify-between"
				onclick={() => (isTranslationDropdownOpen = !isTranslationDropdownOpen)}
			>
				<span>None — click to select a translation</span>
				<span class="material-icons text-base"
					>{isTranslationDropdownOpen ? 'expand_less' : 'expand_more'}</span
				>
			</button>
		{/if}

		<!-- Dropdown panel -->
		{#if isTranslationDropdownOpen}
			<div class="rounded-xl border border-color bg-primary shadow-xl overflow-hidden">
				<!-- Search + tabs -->
				<div class="p-3 border-b border-color space-y-2">
					<input
						type="text"
						bind:value={translationSearchQuery}
						placeholder="Search languages or authors..."
						class="w-full rounded-lg border border-color bg-bg-secondary px-3 py-2 text-sm text-primary placeholder:text-thirdly focus:outline-none focus:border-accent-primary"
					/>
					<div class="flex items-center rounded-lg border border-color bg-bg-secondary p-0.5">
						<button
							type="button"
							class="flex-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer {activeTab ===
							'quran-api'
								? 'bg-accent-primary/15 text-primary shadow-sm'
								: 'text-thirdly hover:text-primary'}"
							onclick={() => (activeTab = 'quran-api')}
						>
							Quran API
						</button>
						<button
							type="button"
							class="flex-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer {activeTab ===
							'quran-com-api'
								? 'bg-accent-primary/15 text-primary shadow-sm'
								: 'text-thirdly hover:text-primary'}"
							onclick={() => (activeTab = 'quran-com-api')}
						>
							Quran.com
						</button>
					</div>
				</div>

				<!-- Translations list -->
				<div class="max-h-72 overflow-y-auto">
					{#if activeTab === 'quran-com-api' && isLoadingQdc}
						<div class="flex items-center justify-center py-6 gap-2 text-sm text-thirdly">
							<span class="material-icons animate-spin text-base">autorenew</span>
							Loading Quran.com translations...
						</div>
					{:else if Object.keys(filteredTranslationsMap).length === 0}
						<div class="py-6 text-center text-sm text-thirdly">
							{#if translationSearchQuery}
								No translations match "{translationSearchQuery}"
							{:else}
								No translations available
							{/if}
						</div>
					{:else}
						{#each Object.entries(filteredTranslationsMap) as [language, data] (language)}
							<div class="border-b border-color last:border-b-0">
								<!-- Language header -->
								<div class="flex items-center gap-2 px-3 py-2 bg-secondary sticky top-0">
									{#if data.flag}
										<img src={data.flag} alt={language} class="w-4 h-4" />
									{/if}
									<span class="text-xs font-semibold text-secondary">{language}</span>
									<span class="text-xs text-thirdly">({data.translations.length})</span>
								</div>
								<!-- Editions -->
								{#each data.translations as edition (edition.key || edition.name)}
									<button
										type="button"
										class="w-full text-left px-4 py-2.5 text-sm hover:bg-accent transition-colors cursor-pointer flex items-center justify-between gap-2"
										onclick={() => selectTranslation(edition)}
									>
										<div class="min-w-0 flex items-center gap-1.5">
											{#if edition.comments === 'Ponctuation' || edition.comments === 'Saheeh International'}
												<span class="material-icons text-yellow-200 text-xs shrink-0">star</span>
											{/if}
											<span class="text-primary font-medium truncate">{edition.author}</span>
										</div>
										<span class="material-icons text-thirdly text-sm shrink-0 opacity-30"
											>add_circle_outline</span
										>
									</button>
								{/each}
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/if}

		<p class="text-xs text-thirdly">Select a translation to include in the video subtitles.</p>
	</div>

	<!-- Let AI choose checkbox -->
	<label
		class="flex items-center gap-3 rounded-xl border border-color bg-bg-secondary px-4 py-3 cursor-pointer hover:border-accent-primary/50 transition-all"
	>
		<input
			type="checkbox"
			bind:checked={letAiChoose}
			class="h-4 w-4 rounded accent-[var(--accent-primary)]"
		/>
		<div>
			<span class="text-sm font-medium text-primary">Let AI choose the verse range</span>
			<p class="text-xs text-thirdly mt-0.5">
				AI will select the best Quran verse range based on your theme.
			</p>
		</div>
	</label>
</div>
