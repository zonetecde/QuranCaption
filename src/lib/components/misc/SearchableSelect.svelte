<script lang="ts">
	type SearchableSelectOption = {
		value: string;
		label: string;
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
		onChange
	}: Props = $props();

	let isOpen = $state(false);
	let search = $state('');

	let selectedOption = $derived(options.find((option) => option.value === value));
	let filteredOptions = $derived.by(() => {
		const query = normalizeText(search);
		if (!query) return options;
		return options.filter((option) => normalizeText(option.label).includes(query));
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
		class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary text-sm placeholder:text-thirdly disabled:opacity-50 disabled:cursor-not-allowed"
		onfocus={openDropdown}
		onclick={openDropdown}
		oninput={(event) => {
			search = event.currentTarget.value;
			isOpen = true;
		}}
		onkeydown={handleKeydown}
		onblur={closeDropdown}
	/>

	{#if isOpen}
		<div
			class="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-auto rounded-xl border border-color bg-primary shadow-xl z-100"
		>
			{#if filteredOptions.length === 0}
				<p class="px-4 py-3 text-sm text-thirdly">{emptyMessage}</p>
			{:else}
				{#each filteredOptions as option (option.value)}
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
						{option.label}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
