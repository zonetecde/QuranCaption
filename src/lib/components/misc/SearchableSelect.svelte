<script lang="ts">
	type SearchableSelectOption = {
		value: string;
		label: string;
		icon?: string;
		searchAliases?: string[];
		disabled?: boolean;
	};

	type Props = {
		value: string;
		options: SearchableSelectOption[];
		id?: string;
		placeholder?: string;
		searchPlaceholder?: string;
		emptyMessage?: string;
		disabled?: boolean;
		/** Classe Tailwind de hauteur max du panneau déroulant (défaut `max-h-60`). */
		maxHeightClass?: string;
		wrapOptions?: boolean;
		onChange?: (value: string) => void;
	};

	let {
		value = $bindable(),
		options = [],
		id,
		placeholder = 'Select an option',
		searchPlaceholder = 'Search...',
		emptyMessage = 'No options found',
		disabled = false,
		maxHeightClass = 'max-h-60',
		wrapOptions = false,
		onChange
	}: Props = $props();

	let isOpen = $state(false);
	let search = $state('');

	let selectedOption = $derived(options.find((option) => option.value === value));
	let filteredOptions = $derived.by(() => {
		const query = normalizeText(search);
		if (!query) return options;

		const result: SearchableSelectOption[] = [];
		const addedHeaders = new Set<string>();
		let currentHeader: SearchableSelectOption | null = null;
		let isHeaderMatch = false;

		for (const option of options) {
			const isMatch = [option.label, ...(option.searchAliases ?? [])].some((candidate) =>
				normalizeText(candidate).includes(query)
			);
			if (option.disabled) {
				currentHeader = option;
				isHeaderMatch = isMatch;
				continue;
			}

			if (isMatch || isHeaderMatch) {
				if (currentHeader && !addedHeaders.has(currentHeader.value)) {
					result.push(currentHeader);
					addedHeaders.add(currentHeader.value);
				}
				result.push(option);
			}
		}

		return result;
	});

	/**
	 * Normalise un texte pour la recherche insensible aux espacements simples.
	 * @param {string} text Texte a normaliser.
	 * @returns {string} Texte normalise.
	 */
	function normalizeText(text: string): string {
		return text.toLowerCase().replaceAll(' ', '').replaceAll('-', '').replaceAll('.', '');
	}

	/**
	 * Decoupe un label pour surligner la partie qui correspond a la recherche.
	 * @param {string} label Texte affiche dans l'option.
	 * @returns {{ before: string; match: string; after: string }} Parties du label.
	 */
	function getHighlightedLabelParts(label: string): {
		before: string;
		match: string;
		after: string;
	} {
		if (!search.trim()) return { before: label, match: '', after: '' };

		const index = label.toLowerCase().indexOf(search.trim().toLowerCase());
		if (index === -1) return { before: label, match: '', after: '' };

		return {
			before: label.slice(0, index),
			match: label.slice(index, index + search.trim().length),
			after: label.slice(index + search.trim().length)
		};
	}

	/**
	 * Ouvre la liste et prepare une recherche vide.
	 * @returns {void}
	 */
	function openDropdown() {
		if (disabled) return;
		search = '';
		isOpen = true;
	}

	/**
	 * Ferme la liste apres les clics souris sur une option.
	 * @returns {void}
	 */
	function closeDropdown() {
		setTimeout(() => {
			isOpen = false;
			search = '';
		}, 150);
	}

	/**
	 * Selectionne une option et notifie le parent.
	 * @param {SearchableSelectOption} option Option selectionnee.
	 * @returns {void}
	 */
	function selectOption(option: SearchableSelectOption) {
		if (option.disabled) return;
		value = option.value;
		onChange?.(value);
		isOpen = false;
		search = '';
	}

	/**
	 * Gere les raccourcis clavier principaux du select.
	 * @param {KeyboardEvent} event Evenement clavier.
	 * @returns {void}
	 */
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			isOpen = false;
			search = '';
			return;
		}

		if (event.key === 'Enter' && isOpen) {
			event.preventDefault();
			const firstEnabledOption = filteredOptions.find((option) => !option.disabled);
			if (firstEnabledOption) selectOption(firstEnabledOption);
		}
	}
</script>

<div class="relative">
	<input
		{id}
		type="text"
		value={isOpen ? search : selectedOption?.label || ''}
		placeholder={isOpen ? searchPlaceholder : placeholder}
		autocomplete="off"
		{disabled}
		class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary text-sm placeholder:text-thirdly disabled:opacity-50 disabled:cursor-not-allowed {selectedOption?.icon &&
		!isOpen
			? 'pr-10'
			: ''}"
		onfocus={openDropdown}
		onclick={openDropdown}
		oninput={(event) => {
			search = event.currentTarget.value;
			isOpen = true;
		}}
		onkeydown={handleKeydown}
		onblur={closeDropdown}
	/>
	{#if selectedOption?.icon && !isOpen}
		<span
			class="material-icons-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[16px] text-[var(--accent-primary)]"
			aria-hidden="true"
		>
			{selectedOption.icon}
		</span>
	{/if}

	{#if isOpen}
		<div
			class="absolute left-0 right-0 top-full mt-1 {maxHeightClass} overflow-auto rounded-xl border border-color bg-primary shadow-xl z-100"
		>
			{#if filteredOptions.length === 0}
				<p class="px-4 py-3 text-sm text-thirdly">{emptyMessage}</p>
			{:else}
				{#each filteredOptions as option (option.value)}
					{@const labelParts = getHighlightedLabelParts(option.label)}
					<button
						type="button"
						disabled={option.disabled}
						class="w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-color last:border-b-0 disabled:opacity-50 disabled:cursor-not-allowed {option.value ===
						value
							? 'bg-accent text-accent-primary'
							: 'text-primary hover:bg-accent cursor-pointer'}"
						onmousedown={(event) => {
							event.preventDefault();
							selectOption(option);
						}}
					>
						<span class="flex min-w-0 items-center justify-between gap-2">
							<span
								class="min-w-0 {wrapOptions
									? 'line-clamp-2 whitespace-normal break-words leading-snug'
									: 'truncate'}"
							>
								{labelParts.before}{#if labelParts.match}
									<mark class="rounded bg-[var(--accent-primary)]/25 px-0.5 text-accent-primary"
										>{labelParts.match}</mark
									>
								{/if}{labelParts.after}
							</span>
							{#if option.icon}
								<span
									class="material-icons-outlined shrink-0 text-[16px] text-[var(--accent-primary)]"
									aria-hidden="true"
								>
									{option.icon}
								</span>
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
