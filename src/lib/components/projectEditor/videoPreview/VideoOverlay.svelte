<script lang="ts">
	import { CustomTextClip, ProjectEditorTabs, SubtitleClip, Translation } from '$lib/classes';
	import type { StyleCategoryName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { untrack } from 'svelte';
	import ReciterName from '../tabs/styleEditor/ReciterName.svelte';
	import SurahName from '../tabs/styleEditor/SurahName.svelte';
	import VerseNumber from '../tabs/styleEditor/VerseNumber.svelte';
	import CustomText from '../tabs/styleEditor/CustomText.svelte';
	import CustomImage from '../tabs/styleEditor/CustomImage.svelte';
	import { CustomImageClip } from '$lib/classes/Clip.svelte';
	import { PredefinedSubtitleClip } from '$lib/classes';

	const fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		});
	});

	// Sous-titre de référence pour afficher les backgrounds en continu
	let backgroundSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			const track = globalState.getSubtitleTrack;
			const cur = track.getCurrentSubtitleToDisplay();
			if (cur) return cur;

			const clips = track.clips;
			if (!clips || clips.length === 0) return null;

			const time = getTimelineSettings().cursorPosition;
			let indexAfter = clips.findIndex((c) => time < c.startTime);

			// Cherche d'abord le sous-titre (normal ou prédéfini) précédent
			if (indexAfter === -1) {
				// Après le dernier clip: on cherche depuis la fin
				for (let i = clips.length - 1; i >= 0; i--) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
			} else {
				for (let i = indexAfter - 1; i >= 0; i--) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
				// Pas de précédent: on prend le prochain
				for (let i = indexAfter; i < clips.length; i++) {
					const c = clips[i];
					if (c instanceof SubtitleClip || c instanceof PredefinedSubtitleClip) return c;
				}
			}

			return null;
		});
	});

	let currentSubtitleTranslations = $derived(() => {
		const subtitle = currentSubtitle();
		if (!subtitle) return [];
		return subtitle.translations;
	});

	// Contient les textes custom à afficher à ce moment précis
	let currentCustomClips = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getCustomClipTrack.getCurrentClips();
		});
	});

	// Calcul de l'opacité des sous-titres (prend en compte les overrides par clip)
	let subtitleOpacity = $derived((target: string) => {
		const subtitle = currentSubtitle();
		if (!subtitle) return 0;

		const clipId = subtitle.id;
		let maxOpacity = Number(
			globalState.getVideoStyle.getStylesOfTarget(target).getEffectiveValue('opacity', clipId)
		);

		const currentTime = getTimelineSettings().cursorPosition;
		const endTime = subtitle.endTime;
		const timeLeft = endTime - currentTime;
		const halfFade = fadeDuration() / 2;

		if (timeLeft <= halfFade) {
			return Math.max(0, (timeLeft / halfFade) * maxOpacity);
		}

		const startTime = subtitle.startTime;
		const timeSinceStart = currentTime - startTime;

		if (timeSinceStart <= halfFade) {
			return Math.min(maxOpacity, (timeSinceStart / halfFade) * maxOpacity);
		}

		return maxOpacity;
	});

	let getCss = $derived((target: string, clipId?: number, excludedCategories: string[] = []) => {
		return globalState.getVideoStyle
			.getStylesOfTarget(target)
			.generateCSS(clipId, excludedCategories);
	});

	let getTailwind = $derived((target: string) => {
		return globalState.getVideoStyle.getStylesOfTarget(target).generateTailwind();
	});

	// Liste des éditions de traduction configurées dans le projet (pour backgrounds)
	let projectTranslationEditionNames = $derived(() => {
		return globalState.getProjectTranslation.addedTranslationEditions.map((e) => e.name);
	});

	let helperStyles = $derived((target: string) => {
		// Vérifie que la sélection actuelle correspond à la cible
		if (
			globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style &&
			(globalState.getStylesState.currentSelection === target ||
				(globalState.getStylesState.currentSelection === 'translation' &&
					globalState.getStylesState.currentSelectionTranslation === target))
		) {
			let classes = ' ';

			// Si on a certains styles qu'on modifie, on ajoute des styles pour afficher ce qu'ils font
			if (
				globalState.getSectionsState['width'] &&
				globalState.getSectionsState['max-height'] &&
				(globalState.getSectionsState['width'].extended ||
					globalState.getSectionsState['max-height'].extended)
			) {
				classes += 'bg-[#11A2AF]/50 ';
			}

			return classes;
		}
		return '';
	});

	let lastSubtitleId = 0;

	// Variable pour stocker l'AbortController de l'exécution précédente
	let currentAbortController: AbortController | null = null;

	/**
	 * Détecte le target (arabic, traduction, etc.) d'un élément sous-titre
	 * @param element L'élément HTML du sous-titre
	 * @returns Le nom du target ou null si non trouvé
	 */
	function getTargetFromElement(element: HTMLElement): string | null {
		// Chercher dans les classes CSS de l'élément
		const classList = Array.from(element.classList);

		// Vérifier si c'est un sous-titre arabe
		if (classList.includes('arabic')) {
			return 'arabic';
		}

		// Vérifier si c'est une traduction
		const translationKeys = Object.keys(currentSubtitleTranslations() || {});
		for (const translationKey of translationKeys) {
			if (classList.includes(translationKey)) {
				return translationKey;
			}
		}

		return null;
	}

	async function wait(abortSignal: AbortSignal) {
		await new Promise((resolve, reject) => {
			if (abortSignal.aborted) {
				reject(new Error('Aborted'));
				return;
			}
			setTimeout(() => {
				if (abortSignal.aborted) {
					reject(new Error('Aborted'));
				} else {
					resolve(undefined);
				}
			}, 1);
		});
	}

	/**
	 * Gère le max-height (fit on N lines) et la taille de police réactive des sous-titres
	 */
	$effect(() => {
		(async () => {
			if (!currentSubtitle()) return;

			currentSubtitle()!.id;

			// si le sous-titre actuel n'a pas changé (pendant la lecture vidéo)
			if (currentSubtitle()!.id === lastSubtitleId && globalState.getVideoPreviewState.isPlaying)
				return;
			lastSubtitleId = currentSubtitle()!.id;

			globalState.getTimelineState.movePreviewTo;
			globalState.getStyle('arabic', 'max-height').value;
			globalState.getStyle('arabic', 'font-size').value;
			globalState.getStyle('global', 'spacing').value;

			// Cache tout les sous-titres pendant le recalcul pour éviter les sauts visuels
			// sélectionne l'élément d'id subtitles-container
			const subtitlesContainer = document.getElementById('subtitles-container');
			if (subtitlesContainer) {
				subtitlesContainer.style.opacity = '0';
			}

			await untrack(async () => {
				// Annuler l'exécution précédente si elle existe
				if (currentAbortController) {
					currentAbortController.abort();
				}

				// Créer un nouveau AbortController pour cette exécution
				currentAbortController = new AbortController();
				const abortSignal = currentAbortController.signal;

				try {
					let targets = ['arabic', ...Object.keys(currentSubtitleTranslations()!)];

					// Remettre à zéro toutes les positions réactives quand on change de sous-titre
					for (const target of targets) {
						globalState.getVideoStyle.getStylesOfTarget(target).setStyle('reactive-y-position', 0);
					}

					// Attendre un peu que le DOM se mette à jour après la remise à zéro
					await wait(abortSignal);

					// Utiliser for...of au lieu de forEach pour un meilleur contrôle async
					for (const target of targets) {
						// Vérifier si l'opération a été annulée
						if (abortSignal.aborted) return;

						try {
							const maxHeightValue = globalState.getStyle(target, 'max-height').value;
							if (maxHeightValue !== 0) {
								// Make the font-size responsive
								let fontSize = globalState.getStyle(target, 'font-size').value as number;

								globalState.getVideoStyle
									.getStylesOfTarget(target)
									.setStyle('reactive-font-size', fontSize);

								await wait(abortSignal);

								const subtitles = document.querySelectorAll('.' + CSS.escape(target) + '.subtitle');

								// Utiliser for...of pour un meilleur contrôle async
								for (const subtitle of subtitles) {
									// Vérifier si l'opération a été annulée
									if (abortSignal.aborted) return;

									// Cette marge qu'on calcule permet de prévenir un bug qui fait que si le texte est en bas ou à droite, il dépasse un peu et donc que ça considère que c'est plus grand que le max-height
									let isVerticalPosNotCentered =
										globalState.getStyle(target, 'vertical-text-alignment').value !== 'center';
									let marge = isVerticalPosNotCentered ? 10 : 0; // Marge supplémentaire si le texte n'est pas centré verticalement

									// Tant que la hauteur du texte est supérieure à la hauteur maximale, on réduit la taille de la police
									while (subtitle.scrollHeight > maxHeightValue + marge && fontSize > 1) {
										// Vérifier si l'opération a été annulée
										if (abortSignal.aborted) return;

										fontSize -= fontSize / 20; // Réduction progressive

										globalState.getVideoStyle
											.getStylesOfTarget(target)
											.setStyle('reactive-font-size', fontSize);

										await wait(abortSignal);
									}
								}
							}
						} catch (error) {
							// Ignorer les erreurs d'annulation
							if (error instanceof Error && error.message === 'Aborted') {
								return;
							}
						}
					}

					// Une fois qu'on a traité tout les abaissements de taille de max-height, on gère les collisions
					// Check si l'anti-collision est activé
					if (globalState.getStyle('global', 'anti-collision').value) {
						// Récupère tous les sous-titres visibles
						const allSubtitles = document.querySelectorAll('.subtitle');
						const subtitleElements = Array.from(allSubtitles) as HTMLElement[];

						// Set pour suivre les paires de collisions déjà traitées
						const processedPairs = new Set<string>();

						// Vérifie les collisions pour chaque sous-titre
						for (let i = 0; i < subtitleElements.length; i++) {
							// Vérifie si l'opération a été annulée
							if (abortSignal.aborted) return;

							const currentElement = subtitleElements[i];

							// Récupère son target
							const currentTarget = getTargetFromElement(currentElement);

							if (!currentTarget) continue;

							const currentRect = currentElement.getBoundingClientRect();

							// Chercher les collisions avec les autres sous-titres (seulement ceux après i pour éviter les doublons)
							for (let j = i + 1; j < subtitleElements.length; j++) {
								const otherElement = subtitleElements[j];
								const otherRect = otherElement.getBoundingClientRect();

								// Détecte son target
								const otherTarget = getTargetFromElement(otherElement);

								// Double check pour pas que ce soit le même élément
								if (!otherTarget || currentTarget === otherTarget) continue;

								// Créer un identifiant unique pour cette paire (ordre alphabétique pour éviter les doublons)
								const pairId = [currentTarget, otherTarget].sort().join('-');

								// Si cette paire a déjà été traitée, passer au suivant
								if (processedPairs.has(pairId)) continue;

								// Vérifier s'il y a une collision entre les deux
								const isColliding = !(
									currentRect.bottom < otherRect.top ||
									currentRect.top > otherRect.bottom ||
									currentRect.right < otherRect.left ||
									currentRect.left > otherRect.right
								);

								if (isColliding) {
									// Une collision est détectée entre currentElement et otherElement

									// Marquer cette paire comme traitée
									processedPairs.add(pairId);

									// Déplacer le sous-titre le plus bas vers le bas
									const targetToAdjust =
										currentRect.top > otherRect.top ? currentTarget : otherTarget;

									// Boucle jusqu'à ce qu'il n'y ait plus de collision ou qu'on atteigne la limite d'itérations
									let stillColliding;
									let iterationCount = 0;
									const maxIterations = 10; // Sécurité pour éviter les boucles infinies

									do {
										iterationCount++;

										// Vérifier si l'opération a été annulée
										if (abortSignal.aborted) return;

										// Recalculer les positions actuelles
										const currentRectLoop = currentElement.getBoundingClientRect();
										const otherRectLoop = otherElement.getBoundingClientRect();

										let spacing = globalState.getStyle('global', 'spacing').value as number;

										// Calculer l'ajustement nécessaire basé sur l'overlap actuel
										const overlapHeight = Math.abs(currentRectLoop.bottom - otherRectLoop.top);
										const adjustmentNeeded = overlapHeight + spacing;

										// Vérifier la valeur actuelle avant modification
										const currentValue = globalState.getStyle(targetToAdjust, 'reactive-y-position')
											.value as number;

										// Incrémenter la position réactive
										const newValue = currentValue + adjustmentNeeded;

										// Appliquer le nouvel ajustement
										globalState.getVideoStyle
											.getStylesOfTarget(targetToAdjust)
											.setStyle('reactive-y-position', newValue);

										// Attendre que le DOM se mette à jour
										await wait(abortSignal);

										// Vérifier les nouvelles positions après ajustement
										const newCurrentRect = currentElement.getBoundingClientRect();
										const newOtherRect = otherElement.getBoundingClientRect();

										// Vérifier s'il y a encore collision
										stillColliding = !(
											newCurrentRect.bottom + spacing < newOtherRect.top ||
											newCurrentRect.top - spacing > newOtherRect.bottom ||
											newCurrentRect.right + spacing < newOtherRect.left ||
											newCurrentRect.left - spacing > newOtherRect.right
										);
									} while (stillColliding && iterationCount < maxIterations);
								}
							}
						}
					}
				} catch (error) {
					// Ignorer les erreurs d'annulation
					if (error instanceof Error && error.message === 'Aborted') {
						return;
					}
				}
			});

			// Une fois tout ça fait, on remet l'opacité normale
			// sélectionne l'élément d'id subtitles-container
			if (subtitlesContainer) {
				subtitlesContainer.style.opacity = '1';
			}
		})();
	});

	let overlaySettings = $derived(() => {
		return {
			enable: globalState.getStyle('global', 'overlay-enable')!.value,
			blur: globalState.getStyle('global', 'overlay-blur')!.value,
			opacity: globalState.getStyle('global', 'overlay-opacity')!.value,
			color: globalState.getStyle('global', 'overlay-color')!.value,
			customCSS: globalState.getStyle('global', 'overlay-custom-css')!.value
		};
	});
</script>

<div class="inset-0 absolute" style="" id="overlay">
	{#if overlaySettings().enable}
		<div
			class="absolute inset-0"
			style="
					background-color: {overlaySettings().color};
					opacity: {overlaySettings().opacity}; {overlaySettings().customCSS};
				"
		></div>

		<div class="absolute inset-0" style="backdrop-filter: blur({overlaySettings().blur}px);"></div>
	{/if}

	<!-- Backgrounds des sous-titres: toujours visibles, basés sur le dernier/next sous-titre -->
	<div
		id="subtitles-backgrounds"
		class="absolute inset-0 flex flex-col items-center justify-center"
	>
		<!-- Background arabe -->
		<div
			class={'arabic absolute subtitle select-none' +
				getTailwind('arabic') +
				helperStyles('arabic')}
			style="{getCss('arabic', backgroundSubtitle() ? backgroundSubtitle()!.id : undefined)};"
		></div>

		<!-- Backgrounds des traductions -->
		{#each projectTranslationEditionNames() as edition}
			{#if globalState.getVideoStyle.doesTargetStyleExist(edition)}
				<div
					class={'translation absolute subtitle select-none ' +
						edition +
						getTailwind(edition) +
						helperStyles(edition)}
					style="{getCss(edition, backgroundSubtitle() ? backgroundSubtitle()!.id : undefined)};"
				></div>
			{/if}
		{/each}
	</div>

	<div class="w-full h-full absolute inset-0 flex flex-col items-center justify-center">
		{#if currentSubtitle()}
			{@const subtitle = currentSubtitle()}
			<div
				id="subtitles-container"
				class="absolute inset-0 flex flex-col items-center justify-center"
			>
				{#if subtitle && subtitle.id}
					<p
						ondblclick={() => {
							globalState.getVideoStyle.highlightCategory('arabic', 'general');
						}}
						use:mouseDrag={{
							target: 'arabic',
							verticalStyleId: 'vertical-position',
							horizontalStyleId: 'horizontal-position'
						}}
						class={'arabic absolute subtitle select-none z-10 ' +
							getTailwind('arabic') +
							helperStyles('arabic')}
						style="opacity: {subtitleOpacity('arabic')}; {getCss('arabic', subtitle.id, [
							'background',
							'border'
						])};"
					>
						{subtitle.getText()}
					</p>
				{/if}

				{#each Object.keys(currentSubtitleTranslations()!) as edition}
					{@const translation = (currentSubtitleTranslations()! as Record<string, Translation>)[
						edition
					]}

					{#if globalState.getVideoStyle.doesTargetStyleExist(edition)}
						<p
							ondblclick={() => {
								globalState.getVideoStyle.highlightCategory(
									'translation',
									edition as StyleCategoryName
								);
							}}
							use:mouseDrag={{
								target: edition,
								verticalStyleId: 'vertical-position',
								horizontalStyleId: 'horizontal-position'
							}}
							class={`translation absolute subtitle select-none z-10 ${edition} ${getTailwind(edition)} ${helperStyles(edition)}`}
							style={`opacity: ${subtitleOpacity(edition)}; ${getCss(edition, subtitle!.id, [
								'background',
								'border'
							])};`}
						>
							{#if translation.type === 'verse'}
								{translation.getText(edition, (subtitle as SubtitleClip)!)}
							{:else}
								{translation.getText()}
							{/if}
						</p>
					{/if}
				{/each}
			</div>
		{/if}

		<SurahName />
		<ReciterName />

		{#if currentSubtitle() instanceof SubtitleClip}
			{@const verseSubtitle = currentSubtitle() as SubtitleClip}
			<VerseNumber currentSurah={verseSubtitle.surah} currentVerse={verseSubtitle.verse} />
		{/if}

		{#each currentCustomClips() as customText}
			{#if customText.type === 'Custom Text'}
				<CustomText customText={(customText as CustomTextClip).category!} />
			{:else if customText.type === 'Custom Image'}
				<CustomImage customImage={(customText as CustomImageClip).category!} />
			{/if}
		{/each}
	</div>
</div>
