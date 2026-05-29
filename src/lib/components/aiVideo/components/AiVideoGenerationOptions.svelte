<script lang="ts">
	import { onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		QdcTranslationService,
		type TranslationLanguageData
	} from '$lib/services/QdcTranslationService';
	import { MOCK_MODELS } from '../constants';
	import type { Edition } from '$lib/classes';
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';

	type AvailableTranslationsMap = Record<string, TranslationLanguageData>;
	type TranslationSelectOption = { value: string; label: string; disabled?: boolean };

	const aiv = globalState.aiVideo;

	let selectedTranslationKey = $state('');
	let isLoadingQdc = $state(false);
	let activeTab = $state<'quran-api' | 'quran-com-api'>('quran-api');

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

	let activeTranslationsMap = $derived.by((): AvailableTranslationsMap => {
		return activeTab === 'quran-api'
			? (globalState.availableTranslations as AvailableTranslationsMap)
			: (globalState.qdcAvailableTranslations as AvailableTranslationsMap);
	});

	let translationSelectOptions = $derived.by(() => {
		const options: TranslationSelectOption[] = [{ value: '', label: 'No translation' }];
		for (const [language, data] of Object.entries(activeTranslationsMap)) {
			options.push({
				value: `language:${language}`,
				label: `${language} (${data.translations.length})`,
				disabled: true
			});
			for (const edition of data.translations) {
				options.push({
					value: getTranslationKey(edition),
					label: edition.author
				});
			}
		}
		return options;
	});

	/**
	 * Retourne la cle stable utilisee par le select de traduction.
	 * @param {Edition} edition Edition de traduction.
	 * @returns {string} Cle unique de l'edition.
	 */
	function getTranslationKey(edition: Edition): string {
		return edition.key || edition.name;
	}

	/**
	 * Applique la traduction choisie dans le select.
	 * @returns {void}
	 */
	function handleTranslationChange() {
		if (!selectedTranslationKey) {
			clearTranslation();
			return;
		}

		for (const data of Object.values(activeTranslationsMap)) {
			const edition = data.translations.find(
				(item) => getTranslationKey(item) === selectedTranslationKey
			);
			if (edition) {
				aiv.selectedTranslation = edition;
				return;
			}
		}
	}

	/**
	 * Change le fournisseur de traductions et repart sans traduction selectionnee.
	 * @param {'quran-api' | 'quran-com-api'} tab Fournisseur de traductions actif.
	 * @returns {void}
	 */
	function setActiveTab(tab: 'quran-api' | 'quran-com-api') {
		if (activeTab === tab) return;
		activeTab = tab;
		clearTranslation();
	}

	/**
	 * Retire la traduction selectionnee.
	 * @returns {void}
	 */
	function clearTranslation() {
		aiv.selectedTranslation = null;
		selectedTranslationKey = '';
	}

	$effect(() => {
		selectedTranslationKey = aiv.selectedTranslation
			? getTranslationKey(aiv.selectedTranslation)
			: '';
	});
</script>

<div class="space-y-5">
	{#if aiv.video.sourceMode === 'ai'}
		<!-- Provider / Model -->
		<div class="space-y-2">
			<label for="ai-model" class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">smart_toy</span>
				Provider / Model
			</label>
			<select
				id="ai-model"
				bind:value={aiv.video.model}
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
					class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {aiv
						.video.resolution === 'portrait'
						? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
						: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
					onclick={() => (aiv.video.resolution = 'portrait')}
				>
					<span class="material-icons text-base align-middle mr-1">stay_current_portrait</span>
					Portrait (9:16)
				</button>
				<button
					type="button"
					class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {aiv
						.video.resolution === 'landscape'
						? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
						: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
					onclick={() => (aiv.video.resolution = 'landscape')}
				>
					<span class="material-icons text-base align-middle mr-1">stay_current_landscape</span>
					Landscape (16:9)
				</button>
			</div>
		</div>
	{/if}

	<!-- Translation selector -->
	<div class="space-y-2">
		<span class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">translate</span>
			Translation
		</span>

		<div class="flex items-center rounded-lg border border-color bg-bg-secondary p-0.5">
			<button
				type="button"
				class="flex-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer {activeTab ===
				'quran-api'
					? 'bg-accent-primary/15 text-primary shadow-sm'
					: 'text-thirdly hover:text-primary'}"
				onclick={() => setActiveTab('quran-api')}
			>
				Quran API
			</button>
			<button
				type="button"
				class="flex-1 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer {activeTab ===
				'quran-com-api'
					? 'bg-accent-primary/15 text-primary shadow-sm'
					: 'text-thirdly hover:text-primary'}"
				onclick={() => setActiveTab('quran-com-api')}
			>
				Quran.com
			</button>
		</div>

		{#if activeTab === 'quran-com-api' && isLoadingQdc}
			<div class="flex items-center gap-2 text-sm text-thirdly py-3">
				<span class="material-icons animate-spin text-base">autorenew</span>
				Loading Quran.com translations...
			</div>
		{:else}
			<SearchableSelect
				id="translation-select"
				bind:value={selectedTranslationKey}
				options={translationSelectOptions}
				placeholder="No translation"
				searchPlaceholder="Search languages or authors..."
				emptyMessage="No translations found"
				onChange={handleTranslationChange}
			/>
		{/if}

		<p class="text-xs text-thirdly">Select a translation to include in the video subtitles.</p>
	</div>

	<!-- Let AI choose checkbox -->
	<label
		class="flex items-center gap-3 rounded-xl border border-color bg-bg-secondary px-4 py-3 cursor-pointer hover:border-accent-primary/50 transition-all"
	>
		<input
			type="checkbox"
			bind:checked={aiv.ai.letAiChoose}
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
