<script lang="ts">
	import { SubtitleClip, type Edition, type Translation } from '$lib/classes';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount, untrack } from 'svelte';
	import { fade, slide } from 'svelte/transition';

	let {
		edition,
		subtitle = $bindable<SubtitleClip>(),
		previousSubtitle
	}: {
		edition: Edition;
		subtitle: SubtitleClip;
		previousSubtitle?: SubtitleClip;
	} = $props();

	let translation = $derived(() => {
		return subtitle.getTranslation(edition) as VerseTranslation;
	});

	// Variables pour gérer le glisser-déposer
	let isDragging = $state(false);
	let dragStartIndex = $state(-1);

	let originalTranslation: string = $state('');
	let translationInput: HTMLInputElement | null = $state(null);

	let previousSubtitleTranslationStartIndex: number = $state(-1);
	let previousSubtitleTranslationEndIndex: number = $state(-1);

	onMount(() => {
		if (translation().type === 'verse') {
			originalTranslation = globalState.getProjectTranslation.getVerseTranslation(
				edition,
				subtitle.getVerseKey()
			);
		}
	});

	$effect(() => {
		// Si le sous-titre d'avant est la continuité du verset:
		if (
			translation().type === 'verse' &&
			previousSubtitle &&
			previousSubtitle.type === 'Subtitle' &&
			previousSubtitle.verse === subtitle.verse &&
			previousSubtitle.surah === subtitle.surah
		) {
			// Alors on highlight toute la traduction du sous-titre précédent
			const previousSubtitleTranslation = previousSubtitle.getTranslation(
				edition
			) as VerseTranslation;

			// Met à jour les indices de début et de fin de la traduction du sous-titre précédent
			if (
				!(
					previousSubtitleTranslation.startWordIndex === 0 &&
					previousSubtitleTranslation.endWordIndex === originalTranslation.split(' ').length - 1 &&
					!previousSubtitleTranslation.isBruteForce
				)
			) {
				previousSubtitleTranslationStartIndex = previousSubtitleTranslation.startWordIndex;
				previousSubtitleTranslationEndIndex = previousSubtitleTranslation.endWordIndex;
			}

			// Si c'est la continuité du verset précédent, on met à jour la traduction
			if (
				previousSubtitle.endWordIndex + 1 === subtitle.startWordIndex && // Vérifie que le sous-titre précédent se termine juste avant le début du sous-titre actuel
				previousSubtitleTranslation.status === 'reviewed' && // vérifie que la traduction du sous-titre précédent n'est pas vide
				!previousSubtitleTranslation.isBruteForce // vérifie que la traduction du sous-titre précédent a été trimmed via l'outil
			) {
				// Commence la sélection de la traduction du verset actuel à celle de fin de la traduction du sous-titre précédent
				if (translation().status !== 'reviewed') {
					translation().startWordIndex = previousSubtitleTranslationEndIndex + 1;
					if (translation().startWordIndex > translation().endWordIndex) {
						translation().endWordIndex = originalTranslation.split(' ').length - 1;
					}
					updateTranslationText();

					// Si c'est les derniers mots du verset, normalement le trim est fait automatiquement
					// donc on met le status à 'automatically trimmed'
					// sinon on le met à 'to review' car il faut encore trim la fin de la traduction
					if (subtitle.isLastWordsOfVerse)
						translation().updateStatus('automatically trimmed', edition);
					else translation().updateStatus('to review', edition);
				}
			} else if (
				previousSubtitleTranslation.status === 'reviewed' &&
				subtitle.startWordIndex === previousSubtitle.startWordIndex &&
				subtitle.endWordIndex === previousSubtitle.endWordIndex
			) {
				// Si c'est exactement la même sélection que le sous-titre précédent, alors on applique la même traduction que lui
				translation().startWordIndex = previousSubtitleTranslation.startWordIndex;
				translation().endWordIndex = previousSubtitleTranslation.endWordIndex;
				translation().isBruteForce = previousSubtitleTranslation.isBruteForce;
				translation().text = previousSubtitleTranslation.text;
				translation().updateStatus('reviewed', edition);
			}
		}
	});

	let lastClickedWordIndex = $state(-1);

	function wordClicked(i: number): any {
		if (translation().type === 'verse') {
			if (i < translation().startWordIndex) {
				// Si le mot est avant le début de la traduction, on le sélectionne
				translation().startWordIndex = i;
				translation().endWordIndex = i;
			} else if (i > translation().endWordIndex) {
				// Si le mot est après la fin de la traduction, on étend la sélection
				translation().endWordIndex = i;
			} else {
				// Si le mot est déjà sélectionné, on arrête la traduction à ce mot SI
				// il nécessite review, sinon reset les curseurs sur ce mot
				if (i >= translation().startWordIndex && i <= translation().endWordIndex) {
					translation().endWordIndex = i;
					if (lastClickedWordIndex === i) {
						translation().startWordIndex = i;
					}
				}
			}

			lastClickedWordIndex = i;

			updateTranslationText();
			translation().updateStatus('reviewed', edition);
		}
	}

	function updateTranslationText() {
		translation().text = originalTranslation
			.split(' ')
			.slice(translation().startWordIndex, translation().endWordIndex + 1)
			.join(' ');
	}

	function handleMouseDown(i: number, event: MouseEvent): void {
		if (translation().type === 'verse') {
			event.preventDefault();
			isDragging = true;
			dragStartIndex = i;
			wordClicked(i);
		}
	}

	function handleMouseEnter(i: number): void {
		if (isDragging && translation().type === 'verse') {
			const startIndex = Math.min(dragStartIndex, i);
			const endIndex = Math.max(dragStartIndex, i);
			translation().startWordIndex = startIndex;
			translation().endWordIndex = endIndex;
			updateTranslationText();
		}
	}

	function handleMouseUp(): void {
		isDragging = false;
		dragStartIndex = -1;
	}

	// Gestionnaire global pour le mouseup
	function handleGlobalMouseUp(): void {
		if (isDragging) {
			handleMouseUp();
		}
	}
</script>

<div
	class="flex flex-col gap-3 mt-4 p-4 bg-accent border border-color rounded-lg transition-all duration-200 group"
	onmouseleave={() => {
		handleMouseUp();
	}}
>
	{#if translation()}
		{@const status = translation().status}
		{@const isCompleted = translation().isStatusComplete()}

		<!-- En-tête avec flag et info -->
		<div class="flex items-center gap-3 pb-2 border-b border-color">
			<div class="flex items-center gap-2">
				{#if globalState.availableTranslations && globalState.availableTranslations[edition.language]}
					<img
						src={globalState.availableTranslations[edition.language].flag}
						alt={edition.language}
						class="w-5 h-5 rounded"
					/>
				{/if}
				<div>
					<p class="text-primary text-sm font-medium">{edition.language}</p>
					<p class="text-thirdly text-xs">{edition.author}</p>
				</div>
			</div>

			<div class="ml-auto">
				<div class="flex items-center gap-2">
					<span class="text-xs text-secondary font-medium">Status:</span>
					<div
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 {isCompleted
							? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30 hover:bg-green-500/30'
							: 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30 hover:bg-orange-500/30'}"
					>
						<div
							class="w-1.5 h-1.5 rounded-full {isCompleted ? 'bg-green-500' : 'bg-orange-500'}"
						></div>
						{#if status === 'completed by default'}
							Completed by default
						{:else if status === 'automatically trimmed'}
							Automatically trimmed
						{:else if status === 'fetched'}
							Fetched
						{:else if status === 'to review'}
							To review
						{:else if status === 'reviewed'}
							Reviewed
						{:else if status === 'ai trimmed'}
							AI trimmed
						{:else if status === 'ai error'}
							AI error
						{:else if status === 'undefined'}
							Undefined
						{:else}
							{status}
						{/if}
					</div>
				</div>
			</div>
		</div>
		{#if translation().type === 'verse' && !translation().isBruteForce}
			<!-- Affiche la traduction complète du verset mot à mot -->
			<div
				class="flex flex-row select-none flex-wrap items-center gap-y-1 opacity-20 group-hover:opacity-100 duration-300"
				role="presentation"
				onmouseup={handleGlobalMouseUp}
				transition:slide
			>
				{#each originalTranslation.split(' ') as word, i}
					{@const isSelected = translation().startWordIndex <= i && i <= translation().endWordIndex}
					{@const isFirstSelected = isSelected && i === translation().startWordIndex}
					{@const isLastSelected = isSelected && i === translation().endWordIndex}
					{@const isSingleSelected =
						isSelected && translation().startWordIndex === translation().endWordIndex}
					{@const isMiddleSelected = isSelected && !isFirstSelected && !isLastSelected}
					{@const isPreviousSubtitleTranslation =
						previousSubtitleTranslationStartIndex !== -1 &&
						previousSubtitleTranslationStartIndex <= i &&
						i <= previousSubtitleTranslationEndIndex}
					<button
						class="translation-word text-sm cursor-pointer px-1 py-1 transition-all duration-200 border-2 border-transparent
						{isPreviousSubtitleTranslation && !isSelected
							? 'bg-yellow-500/10 hover:bg-yellow-500/20! hover:border-yellow-400/20! rounded-none border-yellow-400/10'
							: ''}
						{isSelected
							? // Effet jaune si le mot est sélectionné alors que pourtant il ne devrait pas comme c'est la suite de la traduction du verset précédent
								`translation-word-selected ${isPreviousSubtitleTranslation ? 'bg-purple-500/30! border-purple-400/70! hover:bg-purple-500/80! hover:border-purple-400/80!' : ''} text-[var(--text-on-selected-word)] ${
									isSingleSelected
										? 'translation-word-first-selected translation-word-last-selected'
										: isLastSelected
											? 'translation-word-first-selected'
											: isFirstSelected
												? 'translation-word-last-selected'
												: 'translation-word-middle-selected'
								}`
							: 'translation-word-not-selected text-secondary hover:bg-secondary hover:border-border-color hover:text-primary rounded-md'}
						{isDragging ? 'select-none' : ''}"
						onmousedown={(event) => handleMouseDown(i, event)}
						onmouseenter={() => handleMouseEnter(i)}
						ondragstart={(event) => event.preventDefault()}
					>
						{word}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Indicateur de sélection - toujours visible -->
		<div class="p-2 bg-secondary border border-color rounded-md relative">
			{#if translation().type === 'verse'}
				<!-- toggle: brute force -->
				<label
					class="absolute top-1 right-1.75 text-primary opacity-40 hover:opacity-100 duration-200 cursor-pointer"
				>
					<span class="text-xs">Manually edit</span>
					<!-- prettier-ignore -->
					<input
						type="checkbox"
						bind:checked={(subtitle.translations[edition.name] as VerseTranslation).isBruteForce}
						onchange={(e) => {
							if ((e.target as HTMLInputElement).checked) {
								translation().updateStatus('reviewed', edition);
								setTimeout(() => {
									if (translationInput) {
										translationInput.focus();
									}
								}, 0);
							} else {
								updateTranslationText();
							}
						}}
						class="w-2 h-2 scale-75 rounded"
					/>
				</label>
			{/if}

			<p class="text-xs text-thirdly mb-1">Subtitle translation:</p>
			{#if translation().type === 'verse' && !translation().isBruteForce}
				<p
					class="text-sm font-medium"
					ondblclick={() => {
						(subtitle.translations[edition.name] as VerseTranslation).isBruteForce = true;
						translation().updateStatus('reviewed', edition);
						// Met le focus sur l'input de traduction
						setTimeout(() => {
							if (translationInput) {
								translationInput.focus();
							}
						}, 0);
					}}
				>
					{translation().text}
				</p>
			{:else}
				<!-- prettier-ignore -->
				<input
				bind:this={translationInput}
				type="text"
				bind:value={(subtitle.translations[edition.name] as VerseTranslation).text}
				class="w-full bg-secondary text-primary border border-color rounded-md px-2 py-1 text-sm"
				placeholder="Enter your translation here..."
			/>
			{/if}
		</div>
	{/if}
</div>

<style>
	.translation-word {
		border-left: 0px solid var(--accent-primary);
		border-right: 0px solid var(--accent-primary);
	}

	.translation-word-selected {
		background-color: var(--selected-word-bg);
		border-top: 2px solid var(--accent-primary);
		border-bottom: 2px solid var(--accent-primary);
	}

	.translation-word-first-selected {
		border-right: 2px solid var(--accent-primary);
		border-left: 0px solid var(--accent-primary);

		border-radius: 0 8px 8px 0;

		margin-left: 0;
	}

	.translation-word-last-selected {
		border-left: 2px solid var(--accent-primary);
		border-right: 0px solid var(--accent-primary);

		border-radius: 8px 0 0 8px;
		margin-right: 0;
	}

	/* Si un seul mot est sélectionné, il doit avoir des bords arrondis partout */
	.translation-word-first-selected.translation-word-last-selected {
		border-radius: 8px;
		border: 2px solid var(--accent-primary);
		margin-left: 0;
		margin-right: 0;
	}

	.translation-word-selected:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
		z-index: 10;
		position: relative;
	}
	.translation-word-not-selected:hover {
		background-color: var(--bg-accent);
		border-color: var(--border-color);
		color: var(--text-primary);
	}

	/* Style pour la traduction du sous-titre précédent */
	.translation-word.bg-orange-500\/30 {
		background-color: rgba(249, 115, 22, 0.2);
		border-color: rgba(251, 146, 60, 0.3);
		position: relative;
	}

	.translation-word.bg-orange-500\/30::after {
		content: '';
		position: absolute;
		bottom: -2px;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, rgba(249, 115, 22, 0.6), transparent);
	}
</style>
