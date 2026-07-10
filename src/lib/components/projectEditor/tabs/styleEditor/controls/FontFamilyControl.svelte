<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import QPCFontProvider, { type ImportedFont } from '$lib/services/FontProvider';
	import type { StyleControlValue } from './types';

	type FontPreview = 'latin' | 'arabic' | 'qpc1' | 'qpc2' | 'imported';
	type FontOption = {
		value: string;
		label: string;
		preview: FontPreview;
	};
	type FontControlCopyKey =
		| 'searchFonts'
		| 'noFontsFound'
		| 'importFontFromFile'
		| 'fontFiles'
		| 'fontImportError';

	const LATIN_PREVIEW = 'In the name of Allah, the Most Gracious, the Most Merciful';
	const ARABIC_PREVIEW = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
	const BUILTIN_FONTS: FontOption[] = [
		{ value: 'QPC2', label: 'Uthamic Mushaf QPC2', preview: 'qpc2' },
		{ value: 'QPC1', label: 'Uthamic Mushaf QPC1', preview: 'qpc1' },
		{ value: 'Hafs', label: 'Hafs', preview: 'arabic' },
		{ value: 'IndoPak', label: 'IndoPak', preview: 'arabic' },
		{ value: 'Soosi', label: 'Soosi (Abu Amr)', preview: 'arabic' }
	];
	const BUILTIN_FONT_VALUES = new Set(BUILTIN_FONTS.map((font) => font.value));

	let availableFontsPromise: Promise<string[]> | null = null;
	let { value, onChange }: { value: StyleControlValue; onChange: (value: string) => void } =
		$props();

	let isOpen = $state(false);
	let isImporting = $state(false);
	let searchQuery = $state('');
	let importedFonts: ImportedFont[] = $state([]);
	let searchInput: HTMLInputElement | undefined = $state();
	let triggerButton: HTMLButtonElement | undefined = $state();
	const selectedLabel = $derived(
		importedFonts.find((font) => font.family === String(value))?.label ??
			BUILTIN_FONTS.find((font) => font.value === String(value))?.label ??
			String(value)
	);

	/**
	 * Charge les polices système et les données QPC une seule fois.
	 * @returns {Promise<string[]>} Familles de polices disponibles sur la machine.
	 */
	function getAvailableFonts(): Promise<string[]> {
		availableFontsPromise ??= Promise.all([
			invoke<string[]>('get_system_fonts'),
			QPCFontProvider.loadQPC2Data(),
			QPCFontProvider.loadImportedFonts()
		]).then(([fonts, , loadedImportedFonts]) => {
			importedFonts = loadedImportedFonts;
			return fonts;
		});
		return availableFontsPromise;
	}

	/**
	 * Lit une microcopie du sélecteur avant la génération i18n du hook pre-commit.
	 * @param {FontControlCopyKey} key Clé de traduction à lire.
	 * @returns {string} Texte localisé.
	 */
	function getFontControlCopy(key: FontControlCopyKey): string {
		return (get(LL).editor as unknown as Record<FontControlCopyKey, () => string>)[key]();
	}

	/**
	 * Construit et filtre les options de police affichées dans le panneau.
	 * @param {string[]} systemFonts Familles de polices système.
	 * @returns {FontOption[]} Options correspondant à la recherche courante.
	 */
	function getFilteredFonts(systemFonts: string[]): FontOption[] {
		const query = searchQuery.trim().toLocaleLowerCase();
		const fonts = [
			...importedFonts.map((font) => ({
				value: font.family,
				label: font.label,
				preview: 'imported' as const
			})),
			...BUILTIN_FONTS,
			...systemFonts
				.filter((font) => !BUILTIN_FONT_VALUES.has(font))
				.map((font) => ({ value: font, label: font, preview: 'latin' as const }))
		];
		return query
			? fonts.filter((font) => `${font.label} ${font.value}`.toLocaleLowerCase().includes(query))
			: fonts;
	}

	/**
	 * Retourne le texte d’aperçu adapté à une famille de police.
	 * @param {FontOption} font Police à prévisualiser.
	 * @returns {string} Phrase latine, verset arabe ou glyphes QPC.
	 */
	function getPreviewText(font: FontOption): string {
		if (font.preview === 'qpc1' || font.preview === 'qpc2') {
			return QPCFontProvider.getQuranVerseGlyphWords(
				1,
				1,
				0,
				3,
				font.preview === 'qpc1' ? '1' : '2'
			).join(' ');
		}
		return font.preview === 'arabic' ? ARABIC_PREVIEW : LATIN_PREVIEW;
	}

	/**
	 * Retourne la famille CSS réellement utilisée par l’aperçu.
	 * @param {FontOption} font Police à prévisualiser.
	 * @returns {string} Famille CSS chargée dans le navigateur.
	 */
	function getPreviewFontFamily(font: FontOption): string {
		if (font.preview === 'qpc1' || font.preview === 'qpc2') {
			return QPCFontProvider.getFontNameForVerse(1, 1, font.preview === 'qpc1' ? '1' : '2');
		}
		return font.value;
	}

	/**
	 * Ouvre ou ferme le panneau et place le focus dans la recherche.
	 * @returns {Promise<void>} Promesse résolue après la mise à jour du DOM.
	 */
	async function togglePanel(): Promise<void> {
		isOpen = !isOpen;
		searchQuery = '';
		if (!isOpen) return;
		await tick();
		searchInput?.focus();
	}

	/**
	 * Ferme le panneau lors d’un clic extérieur.
	 * @returns {void}
	 */
	function closePanel(): void {
		isOpen = false;
		searchQuery = '';
	}

	/**
	 * Ferme le panneau avec Échap et restitue le focus au déclencheur.
	 * @param {KeyboardEvent} event Événement clavier global.
	 * @returns {void}
	 */
	function handleWindowKeydown(event: KeyboardEvent): void {
		if (!isOpen || event.key !== 'Escape') return;
		closePanel();
		triggerButton?.focus();
	}

	/**
	 * Applique une police puis ferme le panneau flottant.
	 * @param {string} fontFamily Famille de police sélectionnée.
	 * @returns {void}
	 */
	function selectFont(fontFamily: string): void {
		onChange(fontFamily);
		closePanel();
		triggerButton?.focus();
	}

	/**
	 * Sélectionne, importe et applique une police locale.
	 * @returns {Promise<void>} Promesse résolue après la tentative d’import.
	 */
	async function importFont(): Promise<void> {
		if (isImporting) return;
		const sourcePath = await open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: getFontControlCopy('fontFiles'),
					extensions: ['ttf', 'otf', 'woff', 'woff2']
				}
			]
		});
		if (!sourcePath || Array.isArray(sourcePath)) return;

		isImporting = true;
		try {
			const font = await QPCFontProvider.importFontFromFile(sourcePath);
			importedFonts = [...importedFonts, font].sort((a, b) => a.label.localeCompare(b.label));
			selectFont(font.family);
		} catch (error) {
			console.error('Could not import font file.', error);
			toast.error(getFontControlCopy('fontImportError'));
		} finally {
			isImporting = false;
		}
	}
</script>

<svelte:window onclick={closePanel} onkeydown={handleWindowKeydown} />

<div class="relative" onclick={(event) => event.stopPropagation()}>
	<button
		bind:this={triggerButton}
		type="button"
		class="flex w-full items-center justify-between gap-2 rounded-lg border border-color bg-[var(--bg-secondary)] px-3 py-2 text-left text-sm text-primary transition-colors hover:border-[var(--accent-primary)]"
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		onclick={togglePanel}
	>
		<span class="truncate">{selectedLabel}</span>
		<span class="material-icons-outlined shrink-0 text-[18px]! text-secondary">
			{isOpen ? 'expand_less' : 'expand_more'}
		</span>
	</button>

	{#if isOpen}
		<div
			class="absolute inset-x-0 top-full z-100 mt-1 overflow-hidden rounded-xl border border-color bg-[var(--bg-primary)] shadow-xl"
		>
			<div class="border-b border-color p-2">
				<div class="relative">
					<span
						class="material-icons-outlined pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[17px]! text-secondary"
					>
						search
					</span>
					<input
						bind:this={searchInput}
						bind:value={searchQuery}
						type="text"
						role="searchbox"
						class="w-full rounded-lg border border-color bg-[var(--bg-secondary)] py-2 pr-3 pl-9! text-sm text-primary placeholder:text-secondary"
						placeholder={getFontControlCopy('searchFonts')}
						aria-label={getFontControlCopy('searchFonts')}
					/>
				</div>
			</div>

			<div class="max-h-80 overflow-y-auto p-1">
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-lg border-b border-color px-3 py-2.5 text-left text-sm font-semibold text-accent transition-colors hover:bg-[var(--bg-accent)] disabled:cursor-wait disabled:opacity-60"
					disabled={isImporting}
					onclick={importFont}
				>
					<span class="material-icons-outlined text-[18px]!">upload_file</span>
					<span>
						{isImporting ? $LL.common.loading() : getFontControlCopy('importFontFromFile')}
					</span>
				</button>

				{#await getAvailableFonts()}
					<p class="px-3 py-4 text-center text-sm text-secondary">{$LL.editor.loadingFonts()}</p>
				{:then systemFonts}
					{@const fonts = getFilteredFonts(systemFonts)}
					{#if fonts.length === 0}
						<p class="px-3 py-4 text-center text-sm text-secondary">
							{getFontControlCopy('noFontsFound')}
						</p>
					{:else}
						<div role="listbox">
							{#each fonts as font (font.value)}
								<button
									type="button"
									role="option"
									aria-selected={font.value === String(value)}
									class="group flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-accent)] aria-selected:bg-[color-mix(in_srgb,var(--accent-primary)_18%,var(--bg-secondary))]"
									onclick={() => selectFont(font.value)}
								>
									<span
										class="flex w-full items-center justify-between gap-2 text-xs font-semibold text-primary"
									>
										<span class="truncate">{font.label}</span>
										{#if font.value === String(value)}
											<span class="material-icons-outlined text-[16px]! text-accent">check</span>
										{/if}
									</span>
									{#if font.preview === 'imported'}
										<span
											class="w-full truncate text-base leading-6 text-secondary group-hover:text-primary"
											style:font-family={getPreviewFontFamily(font)}
										>
											{LATIN_PREVIEW}
										</span>
										<span
											class="w-full truncate text-base leading-6 text-secondary group-hover:text-primary"
											dir="rtl"
											style:font-family={getPreviewFontFamily(font)}
										>
											{ARABIC_PREVIEW}
										</span>
									{:else}
										<span
											class="w-full truncate text-base leading-7 text-secondary group-hover:text-primary"
											dir={font.preview === 'latin' ? 'ltr' : 'rtl'}
											style:font-family={getPreviewFontFamily(font)}
										>
											{getPreviewText(font)}
										</span>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				{:catch error}
					<p class="px-3 py-4 text-center text-sm text-secondary">
						{$LL.editor.errorLoadingFonts({
							error: error instanceof Error ? error.message : String(error)
						})}
					</p>
				{/await}
			</div>
		</div>
	{/if}
</div>
