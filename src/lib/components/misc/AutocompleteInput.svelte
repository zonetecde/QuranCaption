<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { onMount, tick } from 'svelte';

	type Props = {
		value: string;
		suggestions: { label: string; isCustom: boolean }[] | string[];
		showEverything?: boolean;
		clearOnFocus?: boolean;
		placeholder?: string;
		maxlength?: number;
		label?: string;
		labelIcon?: string;
		icon: string;
		focusOnMount?: boolean;
		useModalSuggestions?: boolean;
		onEnterPress?: () => void;
		onSelect?: (value: string) => void;
	};

	let {
		value = $bindable(),
		suggestions: rawSuggestions = [],
		showEverything = false,
		clearOnFocus = false,
		placeholder = 'Start typing to search...',
		maxlength = NaN,
		label,
		labelIcon: _labelIcon,
		icon,
		focusOnMount,
		useModalSuggestions = false,
		onEnterPress,
		onSelect
	}: Props = $props();

	// Suggestions state
	let suggestions: { label: string; isCustom: boolean }[] = $state([]);
	let isStringSuggestionsMode: boolean = $state(false);

	// Effect to convert raw suggestions into a uniform format
	$effect(() => {
		isStringSuggestionsMode = rawSuggestions.length === 0 || typeof rawSuggestions[0] === 'string';

		if (isStringSuggestionsMode) {
			// Convert string suggestions to uniform format
			suggestions = (rawSuggestions as string[]).map((label) => ({ label, isCustom: false }));
			return;
		}

		suggestions = rawSuggestions as { label: string; isCustom: boolean }[];
	});

	let input: HTMLInputElement | undefined = $state(undefined);
	let modalInput: HTMLInputElement | undefined = $state(undefined);
	onMount(() => {
		if (input && focusOnMount) {
			input.focus();
			input.select();
		}
	});

	let filteredSuggestions: { label: string; isCustom: boolean }[] = $state([]);
	let showSuggestions: boolean = $state(false);
	let selectedSuggestionIndex: number = $state(-1);
	let openUpwards: boolean = $state(false);
	let modalVisible: boolean = $state(false);

	/**
	 * Chooses the dropdown direction from the input position and available viewport space.
	 */
	function updateDropdownDirection() {
		if (!input || typeof window === 'undefined') return;

		const rect = input.getBoundingClientRect();
		const availableAbove = rect.top;
		const availableBelow = window.innerHeight - rect.bottom;
		const estimatedDropdownHeight = Math.min(filteredSuggestions.length, 5) * 52 + 8;

		openUpwards = availableBelow < estimatedDropdownHeight && availableAbove > availableBelow;
	}

	function normalizeText(text: string): string {
		return text
			.toLowerCase()
			.replaceAll("'", '')
			.replaceAll(' ', '')
			.replaceAll('-', '')
			.replaceAll('.', '');
	}

	/**
	 * Prepends the raw user input as a selectable custom option unless it already matches exactly.
	 */
	function withCustomFirstOption(
		query: string,
		items: { label: string; isCustom: boolean }[]
	): { label: string; isCustom: boolean }[] {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return items;

		const normalizedQuery = normalizeText(trimmedQuery);
		const hasExactMatch = items.some((item) => normalizeText(item.label) === normalizedQuery);
		if (hasExactMatch) return items;

		return [{ label: trimmedQuery, isCustom: true }, ...items];
	}

	// Filter suggestions based on input
	function updateSuggestions() {
		if (!value.trim()) {
			if (showEverything) {
				filteredSuggestions = suggestions;
				showSuggestions = true;
				selectedSuggestionIndex = 0;
				updateDropdownDirection();
			} else {
				filteredSuggestions = [];
				showSuggestions = false;
			}
			return;
		}

		const query = normalizeText(value);
		filteredSuggestions = withCustomFirstOption(
			value,
			suggestions.filter((s) => normalizeText(s.label).includes(query))
		);

		showSuggestions = filteredSuggestions.length > 0;
		selectedSuggestionIndex = 0;
		updateDropdownDirection();
	}

	/**
	 * Ouvre le panneau plein ecran pour une recherche plus stable sur mobile.
	 */
	async function openSuggestionsModal() {
		if (!useModalSuggestions) return;

		modalVisible = true;
		updateSuggestions();
		await tick();
		modalInput?.focus();
		modalInput?.select();
	}

	/**
	 * Ferme le panneau de recherche et replie la liste.
	 */
	function closeSuggestionsModal() {
		modalVisible = false;
		showSuggestions = false;
		selectedSuggestionIndex = -1;
	}

	// Handle suggestion selection
	function selectSuggestion(suggestion: string) {
		value = suggestion;
		showSuggestions = false;
		selectedSuggestionIndex = 0;
		closeSuggestionsModal();
		if (onSelect) {
			onSelect(suggestion);
		}
	}

	// Handle keyboard navigation in suggestions
	function handleKeydown(event: KeyboardEvent) {
		if (!showSuggestions) {
			if (event.key === 'Enter' && onEnterPress) {
				onEnterPress();
			}
			return;
		}

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				selectedSuggestionIndex = Math.min(
					selectedSuggestionIndex + 1,
					filteredSuggestions.length - 1
				);
				break;
			case 'ArrowUp':
				event.preventDefault();
				selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
				break;
			case 'Enter':
				event.preventDefault();
				if (selectedSuggestionIndex >= 0) {
					selectSuggestion(filteredSuggestions[selectedSuggestionIndex].label);
				} else if (useModalSuggestions && modalVisible && filteredSuggestions.length > 0) {
					selectSuggestion(filteredSuggestions[0].label);
				} else if (onEnterPress) {
					onEnterPress();
				}
				break;
			case 'Escape':
				if (useModalSuggestions && modalVisible) {
					closeSuggestionsModal();
				} else {
					showSuggestions = false;
					selectedSuggestionIndex = -1;
				}
				break;
		}
	}
</script>

<div class="space-y-2">
	{#if label}
		<label
			class="flex items-center gap-2 text-sm font-semibold text-primary"
			for="autocomplete-input"
		>
			{#if icon}
				<span class="material-icons text-accent-primary text-base">{icon}</span>
			{/if}
			{label}
		</label>
	{/if}

	<div class="relative">
		<input
			bind:this={input}
			bind:value
			type="text"
			{maxlength}
			class="w-full"
			{placeholder}
			readonly={useModalSuggestions}
			autocomplete="off"
			onclick={() => {
				if (useModalSuggestions) {
					void openSuggestionsModal();
					return;
				}

				if (!showSuggestions) {
					if (clearOnFocus) {
						value = '';
					}
					updateSuggestions();
				}
			}}
			oninput={updateSuggestions}
			onkeydown={handleKeydown}
			onfocus={() => {
				if (useModalSuggestions) {
					void openSuggestionsModal();
					return;
				}

				if (clearOnFocus) {
					value = '';
				}
				updateSuggestions();
			}}
			onblur={() => {
				// Delay hiding to allow click on suggestions
				setTimeout(() => {
					showSuggestions = false;
				}, 150);
			}}
		/>

		{#if maxlength}
			<div class="absolute right-3 top-1/2 transform -translate-y-1/2">
				<span class="text-xs text-thirdly bg-bg-secondary px-2 py-1 rounded-md">
					{value.length}/{maxlength}
				</span>
			</div>
		{/if}
		<!-- Autocomplete Suggestions -->
		{#if !useModalSuggestions && showSuggestions && filteredSuggestions.length > 0}
			<div
				class={`autocomplete-dropdown absolute left-0 right-0 bg-secondary border border-color rounded-lg shadow-2xl max-h-64 overflow-y-auto ${
					openUpwards ? 'bottom-full mb-1' : 'top-full mt-1'
				}`}
			>
				{#each filteredSuggestions as suggestion, index (`${suggestion.label}-${index}`)}
					<button
						class="w-full px-4 py-3 text-left hover:bg-accent transition-colors duration-200 flex items-center gap-3 border-b border-color last:border-b-0
						       {index === selectedSuggestionIndex ? 'bg-accent border-accent-primary' : ''}"
						onmousedown={(e) => {
							e.preventDefault();
							selectSuggestion(suggestion.label);
						}}
						type="button"
					>
						<span class="material-icons text-accent-primary text-sm"
							>{suggestion.isCustom ? 'edit' : icon}</span
						>
						<span class="text-primary font-medium">{suggestion.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if useModalSuggestions && modalVisible}
	<div class="fixed inset-0 z-[1200] bg-black/55 backdrop-blur-sm">
		<div class="flex h-full flex-col bg-primary">
			<div class="border-b border-color px-4 py-4">
				<div class="mb-3 flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p class="truncate text-base font-semibold text-primary">
							{label || $LL.common.search()}
						</p>
						<p class="text-xs text-thirdly">{$LL.common.pressEnterToConfirm()}</p>
					</div>
					<button
						type="button"
						class="btn h-10 w-10 shrink-0 rounded-full p-0"
						aria-label={$LL.common.close()}
						title={$LL.common.close()}
						onclick={closeSuggestionsModal}
					>
						<span class="material-icons-outlined">close</span>
					</button>
				</div>

				<input
					bind:this={modalInput}
					bind:value
					type="text"
					{maxlength}
					class="w-full"
					{placeholder}
					autocomplete="off"
					oninput={updateSuggestions}
					onkeydown={handleKeydown}
				/>
			</div>

			<div class="flex-1 overflow-y-auto p-3">
				{#if filteredSuggestions.length > 0}
					<div class="overflow-hidden rounded-xl border border-color bg-secondary">
						{#each filteredSuggestions as suggestion, index (`modal-${suggestion.label}-${index}`)}
							<button
								class={`flex w-full items-center gap-3 border-b border-color px-4 py-3 text-left transition-colors duration-200 last:border-b-0 ${
									index === selectedSuggestionIndex ? 'bg-accent' : 'hover:bg-accent'
								}`}
								onclick={() => selectSuggestion(suggestion.label)}
								type="button"
							>
								<span class="material-icons text-sm text-accent-primary">
									{suggestion.isCustom ? 'edit' : icon}
								</span>
								<span class="text-primary font-medium">{suggestion.label}</span>
							</button>
						{/each}
					</div>
				{:else}
					<div
						class="flex h-full items-center justify-center px-6 text-center text-sm text-thirdly"
					>
						<span>{placeholder || $LL.common.search()}</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Autocomplete suggestions styling */
	.autocomplete-dropdown {
		animation: slideDown 0.2s ease-out;
		z-index: 9999 !important;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Autocomplete scrollbar */
	.max-h-64::-webkit-scrollbar {
		width: 6px;
	}

	.max-h-64::-webkit-scrollbar-track {
		background: var(--bg-accent);
		border-radius: 3px;
	}

	.max-h-64::-webkit-scrollbar-thumb {
		background: var(--timeline-scrollbar);
		border-radius: 3px;
		transition: background 0.2s ease;
	}

	.max-h-64::-webkit-scrollbar-thumb:hover {
		background: var(--timeline-scrollbar-hover);
	}

	/* Override button hover for autocomplete suggestions */
	.autocomplete-dropdown button:hover {
		transform: none !important;
		box-shadow: none !important;
	}
</style>
