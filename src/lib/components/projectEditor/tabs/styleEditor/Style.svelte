<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Style, StyleCategoryName, StyleName } from '$lib/classes/VideoStyle.svelte';
	import { default as StyleComponent } from '$lib/components/projectEditor/tabs/styleEditor/Style.svelte';
	import toast from 'svelte-5-french-toast';
	import { ProjectDetail, type CustomTextClip } from '$lib/classes';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import EditableText from '$lib/components/misc/EditableText.svelte';
	import { ProjectService } from '$lib/services/ProjectService';

	let {
		style,
		target,
		disabled,
		applyValueSimple
	}: {
		style: Style;
		target?: string;
		disabled: boolean;
		applyValueSimple: (value: any) => void;
	} = $props();

	onMount(async () => {
		// Par défaut fermé
		if (!globalState.getSectionsState[style.id])
			globalState.getSectionsState[style.id] = {
				extended: false
			};
		else extended = globalState.getSectionsState[style.id].extended;

		// Si est un style composite
		if (style.valueType === 'composite' && target) {
			// On charge les styles composites
			await globalState.getVideoStyle.getStylesOfTarget(target).loadCompositeStyles();
		}

		// Si le style est sur le récitateur du projet, bind la valeur au récitateur du projet
		if (style.valueType === 'reciter') {
			inputValue = globalState.currentProject!.detail.reciter;
		}

		// Si le style est un file, bind la valeur actuelle
		if (style.valueType === 'file' && style.value) {
			selectedFilePath = style.value as string;
		}
	});

	let extended = $state(false);
	let selectedOrientation = $state('landscape');
	let selectedQuality = $state('1080p');
	let selectedFilePath = $state('');

	// Function to open file selector
	async function selectFile() {
		const result = await open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: 'Image Files',
					extensions: ['png', 'jpg', 'jpeg', 'gif']
				}
			]
		});

		if (result) {
			selectedFilePath = result as string;
			applyValueSimple(selectedFilePath);
		}
	}

	$effect(() => {
		globalState.getSectionsState[style.id] = {
			extended: extended
		};
	});

	// Initialize orientation and quality based on current dimensions
	$effect(() => {
		if (style.valueType === 'dimension') {
			const current = style.value as any;
			// Detect current orientation and quality
			if (current.width > current.height) {
				selectedOrientation = 'landscape';
			} else {
				selectedOrientation = 'portrait';
			}

			// Detect quality based on exact dimensions (not just >= comparison)
			const maxDimension = Math.max(current.width, current.height);
			const minDimension = Math.min(current.width, current.height);

			if (maxDimension === 3840 && minDimension === 2160) {
				selectedQuality = '2160p';
			} else if (maxDimension === 2560 && minDimension === 1440) {
				selectedQuality = '1440p';
			} else if (maxDimension === 1920 && minDimension === 1080) {
				selectedQuality = '1080p';
			} else if (maxDimension === 1280 && minDimension === 720) {
				selectedQuality = '720p';
			} else {
				// Pour les dimensions custom, choisir la qualité la plus proche
				if (maxDimension >= 3000) {
					selectedQuality = '2160p';
				} else if (maxDimension >= 2000) {
					selectedQuality = '1440p';
				} else if (maxDimension >= 1500) {
					selectedQuality = '1080p';
				} else {
					selectedQuality = '720p';
				}
			}
		}
	});

	// Gestion sélection de clips
	const selectedClipIds = $derived(() =>
		globalState.currentProject!.projectEditorState.stylesEditor.selectedSubtitles.map((s) => s.id)
	);

	function getEffectiveForSelection(): {
		value: any;
		mixed: boolean;
		overridden: boolean;
	} {
		if (!target) return { value: style.value, mixed: false, overridden: false };

		if (selectedClipIds().length === 0) {
			return { value: style.value, mixed: false, overridden: false };
		}

		const values = selectedClipIds().map((id) =>
			globalState.getVideoStyle
				.getStylesOfTarget(target)
				.getEffectiveValue(style.id as StyleName, id)
		);
		const first = values[0];
		const mixed = values.some((v) => String(v) !== String(first));
		const overridden = globalState.getVideoStyle
			.getStylesOfTarget(target)
			.hasOverrideForAny(selectedClipIds(), style.id as StyleName);
		return { value: mixed ? first : first, mixed, overridden };
	}

	// Drapeaux visuels
	const isMixed = $derived(() =>
		selectedClipIds().length > 0 ? getEffectiveForSelection().mixed : false
	);
	const isOverridden = $derived(() =>
		selectedClipIds().length > 0 ? getEffectiveForSelection().overridden : false
	);

	let inputValue: any = $state(style.value);
	$effect(() => {
		const eff = getEffectiveForSelection();
		inputValue = eff.value;
	});

	function coerce(val: any) {
		if (style.valueType === 'number') return Number(val);
		if (style.valueType === 'boolean') return Boolean(val);
		return val as any;
	}

	function applyValue(v: any) {
		const value = coerce(v);
		if (selectedClipIds().length > 0) {
			globalState.getVideoStyle
				.getStylesOfTarget(target!)
				.setStyleForClips(selectedClipIds(), style.id as StyleName, value);
		} else {
			applyValueSimple(value);
		}

		// Déclenche un refresh éventuel (ex: max-height fit)
		if (
			style.id === 'max-height' ||
			style.id === 'font-size' ||
			style.id === 'word-spacing' ||
			style.id === 'font-family'
		) {
			globalState.updateVideoPreviewUI();
		}
	}

	/**
	 * Applique les dimensions sélectionnées à la vidéo
	 */
	function applySelectedDimensions() {
		const dimensions = getDimensionsFromSelection(selectedOrientation, selectedQuality);
		applyValue(dimensions);
	}

	/**
	 * Récupère les dimensions en fonction de l'orientation et de la qualité sélectionnées
	 * @param orientation L'orientation de la vidéo (landscape ou portrait)
	 * @param quality La qualité de la vidéo (720p, 1080p, etc.)
	 */
	function getDimensionsFromSelection(orientation: string, quality: string) {
		const isLandscape = orientation === 'landscape';

		let width: number, height: number;

		switch (quality) {
			case '720p':
				width = isLandscape ? 1280 : 720;
				height = isLandscape ? 720 : 1280;
				break;
			case '1080p':
				width = isLandscape ? 1920 : 1080;
				height = isLandscape ? 1080 : 1920;
				break;
			case '1440p':
				width = isLandscape ? 2560 : 1440;
				height = isLandscape ? 1440 : 2560;
				break;
			case '2160p':
				width = isLandscape ? 3840 : 2160;
				height = isLandscape ? 2160 : 3840;
				break;
			default:
				width = isLandscape ? 1920 : 1080;
				height = isLandscape ? 1080 : 1920;
		}

		return { width, height };
	}

	/**
	 * Prévisualise la résolution de la vidéo après application des dimensions
	 */
	function getPreviewResolution(): string {
		if (!selectedOrientation || !selectedQuality) return '';
		const dimensions = getDimensionsFromSelection(selectedOrientation, selectedQuality);
		return `${dimensions.width}×${dimensions.height}`;
	}

	/**
	 * Efface les styles différents de son parent appliqués aux clips sélectionnés
	 */
	function clearOverride() {
		if (selectedClipIds().length === 0) return;
		globalState.getVideoStyle.getStylesOfTarget(target!).clearStyleForClips(
			selectedClipIds(),

			style.id as StyleName
		);
	}

	/**
	 * Effect permettant de fermer le style si celui-ci se fait désactiver
	 */
	$effect(() => {
		if (disabled) {
			extended = false; // Si le style est désactivé, on le ferme
			return;
		}
	});

	/**
	 * Permet de convertir un temps en ms en un temps capable d'être affiché
	 * dans un input de type 'time'
	 * @param value La valeur à convertir
	 */
	function msToTimeValue(value: number): string {
		const totalSeconds = Math.floor(value / 1000);
		const hh = Math.floor(totalSeconds / 3600);
		const mm = Math.floor((totalSeconds % 3600) / 60);
		const ss = totalSeconds % 60;
		const pad = (n: number) => String(n).padStart(2, '0');

		return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
	}

	function getStyleValue() {
		if (style.valueType === 'composite') {
			return 'Click to expand';
		} else if (style.valueType === 'reciter') {
			return globalState.currentProject!.detail.reciter || 'No reciter selected';
		} else if (style.valueType === 'dimension') {
			return (style.value as any).width + 'x' + (style.value as any).height;
		} else return String(style.value);
	}
</script>

<div
	class={'flex flex-col duration-150 rounded-xl overflow-hidden ' +
		(extended ? 'bg-accent/40 ring-1 ring-color my-2' : 'hover:bg-accent/20') +
		(isMixed()
			? ' border border-fuchsia-400/60'
			: isOverridden()
				? ' border border-amber-400/60'
				: ' border border-transparent')}
>
	<!-- Header -->
	<div
		class={'flex items-center justify-between py-1.25 px-2 cursor-pointer select-none ' +
			(extended ? 'border-b border-color ' : '') +
			(disabled ? 'opacity-50 pointer-events-none' : '')}
		onclick={() => {
			// Impossible d'étendre un style booléen, comme on a le switch directement pour le mettre en true/false
			if (style.valueType !== 'boolean') extended = !extended;
			else applyValue(!inputValue);
		}}
	>
		<div class="flex items-center gap-2">
			<span class="material-icons-outlined text-[20px]! text-secondary">{style.icon}</span>
			<span class="text-sm text-primary font-medium">{style.name}</span>
		</div>
		{#key selectedClipIds().length + String(inputValue)}
			<div class="flex items-center gap-2 text-xs text-secondary">
				{#if selectedClipIds().length > 0}
					{#if getEffectiveForSelection().mixed}
						<span
							class="px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-400/40 flex items-center gap-1"
						>
							<span class="material-icons-outlined text-[12px]">scatter_plot</span>
							mixte
						</span>
					{:else if getEffectiveForSelection().overridden}
						<span
							class="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-400/40 flex items-center gap-1 cursor-auto"
						>
							<span class="material-icons-outlined text-[12px]">auto_fix_high</span>
							override: {getEffectiveForSelection().value}
						</span>
					{:else}
						<span>{String(inputValue)}</span>
					{/if}
				{:else if style.valueType === 'time'}
					<span>{msToTimeValue(Number(inputValue))}</span>
				{:else if style.valueType === 'boolean'}
					<label class="inline-flex items-center cursor-pointer select-none scale-75 origin-right">
						<input
							type="checkbox"
							class="sr-only peer"
							checked={Boolean(inputValue)}
							onchange={(e) => applyValue((e.target as HTMLInputElement).checked)}
						/>
						<div
							class="relative w-11 h-6 rounded-full border border-color bg-[var(--bg-accent)]
			transition-colors duration-150 peer-checked:bg-[var(--accent-primary)]
			peer-checked:[&>span]:translate-x-5"
						>
							<span
								class="absolute left-1 top-0.75 w-4 h-4 bg-white rounded-full shadow
				transition-transform duration-150"
							>
							</span>
						</div>
					</label>
				{:else}
					<span class="truncate max-w-[140px]">{getStyleValue()}</span>
				{/if}

				{#if selectedClipIds().length > 0 && (getEffectiveForSelection().overridden || getEffectiveForSelection().mixed) && target !== 'global'}
					<button
						class="ml-1 text-[11px] px-2 py-1 rounded border hover:opacity-90 duration-100 flex items-center gap-1 cursor-pointer"
						title="Reset override for selection"
						onclick={(e) => {
							e.stopPropagation();
							clearOverride();
						}}
					>
						<span class="material-icons-outlined text-[12px]">restart_alt</span>
						Reset
					</button>
				{/if}
			</div>
		{/key}
	</div>

	{#if extended}
		<div class="my-2 px-2" transition:slide>
			<p class="text-xs text-secondary mb-2 flex items-center gap-1">
				<span class="material-icons-outlined text-[12px]">info</span>
				{style.description}
			</p>

			<!-- Modificateur de valeur -->
			{#if style.valueType === 'number'}
				<div class="flex gap-x-2 items-center">
					<input
						class="w-full accent-accent"
						type="range"
						min={style.valueMin}
						max={style.valueMax}
						step={style.step || 1}
						value={inputValue}
						oninput={(e) => {
							inputValue = (e.target as HTMLInputElement).value;
							applyValue((e.target as HTMLInputElement).value);
						}}
					/>

					<!-- met aussi un input number -->
					<div class="relative">
						<input
							type="number"
							min={style.valueMin}
							max={style.valueMax}
							step={style.step || 1}
							value={inputValue}
							oninput={(e) => {
								inputValue = (e.target as HTMLInputElement).value;
								applyValue((e.target as HTMLInputElement).value);
							}}
							class="w-24"
						/>
					</div>
				</div>
			{:else if style.valueType === 'color'}
				<div class="flex gap-x-2 items-center">
					<input
						type="color"
						value={String(inputValue)}
						class="w-full h-8 rounded"
						oninput={(e) => applyValue((e.target as HTMLInputElement).value)}
					/>
					<div class="relative">
						<input
							type="text"
							value={String(inputValue)}
							class="w-24"
							oninput={(e) => applyValue((e.target as HTMLInputElement).value)}
						/>
					</div>
				</div>
			{:else if style.valueType === 'select'}
				<div class="relative">
					<select
						class="w-full mt-1"
						value={String(inputValue)}
						onchange={(e) => {
							applyValue((e.target as HTMLSelectElement).value);
						}}
					>
						{#if style.id === 'font-family'}
							{#await invoke('get_system_fonts')}
								<option value="" disabled selected>Loading fonts...</option>
							{:then fonts: any}
								<option value="QPC2">Uthamic Mushaf QPC2</option>
								<option value="QPC1">Uthamic Mushaf QPC1</option>
								<option value="Hafs">Hafs</option>
								{#each fonts as font}
									<option value={font}>{font}</option>
								{/each}
							{:catch error}
								<option value="" disabled>Error loading fonts: {error.message}</option>
							{/await}
						{:else}
							{#each style.options || [] as option}
								<option value={option}>{option}</option>
							{/each}
						{/if}
					</select>
				</div>
			{:else if style.valueType === 'text'}
				{#if style.id.includes('css')}
					<div class="relative">
						<textarea
							value={String(inputValue)}
							class="w-full mono"
							rows="5"
							oninput={(e) => applyValue((e.target as HTMLTextAreaElement).value)}
						></textarea>
					</div>
				{:else}
					<div class="relative">
						<input
							type="text"
							value={String(inputValue)}
							class="w-full mono"
							oninput={(e) => applyValue((e.target as HTMLInputElement).value)}
						/>
					</div>
				{/if}
			{:else if style.valueType === 'time'}
				<div class="relative flex flex-row gap-x-2 items-center">
					<input
						type="time"
						class="w-full"
						oninput={(e) => {
							// Convertis en ms et applique
							const timeString = (e.target as HTMLInputElement).value;
							const [hh, mm, ss] = timeString.split(':').map(Number);
							const totalSeconds = hh * 3600 + mm * 60 + ss;
							applyValue(totalSeconds * 1000);
						}}
						value={msToTimeValue(style.value as number)}
					/>
					<span>or</span>
					<button
						class="btn-accent text-sm py-1 min-w-[150px]"
						title="Use the preview timeline cursor time and put it into the time field"
						onclick={(e) => {
							let currentPreviewTime = globalState.getTimelineState.cursorPosition;

							applyValue(currentPreviewTime);
						}}
					>
						Use preview cursor time
					</button>
				</div>
			{:else if style.valueType === 'reciter'}
				{@const reciter = RecitersManager.getReciterObject(
					globalState.currentProject!.detail.reciter
				)}
				<div class="flex flex-col gap-x-2">
					<EditableText
						text="Enter project reciter"
						bind:value={globalState.currentProject!.detail.reciter}
						maxLength={ProjectDetail.RECITER_MAX_LENGTH}
						placeholder={globalState.currentProject!.detail.reciter}
						textClasses="font-semibold"
						action={async () => {
							await ProjectService.saveDetail(globalState.currentProject!.detail); // Sauvegarde le projet
						}}
						inputType="reciters"
					/>

					{#if reciter.number !== -1}
						<p class="reciters-font text-3xl -mr-3 text-center">
							{reciter.number}
						</p>
					{:else}
						<p class="text-sm mt-2 text-yellow-500">
							<span class="material-icons align-middle text-[18px]!">block</span>
							Arabic calligraphy is not available for this reciter.
						</p>
					{/if}
				</div>
			{:else if style.valueType === 'file'}
				<div class="flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<button
							type="button"
							onclick={selectFile}
							class="btn-accent w-full flex items-center justify-center py-2 px-3 rounded-md text-sm cursor-pointer transition-colors duration-200"
							{disabled}
						>
							<span class="material-icons mr-2 text-base">folder_open</span>
							Pick an image
						</button>
					</div>
					{#if selectedFilePath}
						<div class="bg-gray-100 dark:bg-gray-800 p-3 rounded-md">
							<p class="text-sm text-gray-700 dark:text-gray-300 font-mono break-all">
								{selectedFilePath}
							</p>
						</div>
					{/if}
				</div>
			{:else if style.valueType === 'dimension'}
				<div class="flex flex-col gap-4">
					<!-- Orientation Selection -->
					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Orientation:</p>
						<div class="flex gap-4">
							{#each [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }] as orientation}
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										name="orientation"
										value={orientation.value}
										bind:group={selectedOrientation}
										class="accent-accent"
									/>
									<span class="text-sm">{orientation.label}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Quality Selection -->
					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Quality:</p>
						<div class="flex gap-4 flex-wrap">
							{#each [{ value: '720p', label: '720p', width: 1280, height: 720 }, { value: '1080p', label: '1080p', width: 1920, height: 1080 }, { value: '1440p', label: '1440p (2K)', width: 2560, height: 1440 }, { value: '2160p', label: '2160p (4K)', width: 3840, height: 2160 }] as quality}
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										name="quality"
										value={quality.value}
										bind:group={selectedQuality}
										class="accent-accent"
									/>
									<span class="text-sm">{quality.label}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Apply Button -->
					<button
						class="btn-accent w-full py-2 mt-2"
						onclick={() => applySelectedDimensions()}
						disabled={!selectedOrientation || !selectedQuality}
					>
						Apply {getPreviewResolution()}
					</button>

					<!-- Custom Dimensions -->
					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Custom dimensions:</p>
						<div class="flex flex-row items-center gap-x-2">
							<input
								type="number"
								class="w-full"
								oninput={(e) => {
									const width = parseInt((e.target as HTMLInputElement).value);
									const height = (style.value as any).height;
									applyValue({ width, height });
								}}
								value={(style.value as any).width}
								min="256"
								max="7680"
							/>
							<span>×</span>
							<input
								type="number"
								class="w-full"
								oninput={(e) => {
									const width = (style.value as any).width;
									const height = parseInt((e.target as HTMLInputElement).value);
									applyValue({ width, height });
								}}
								value={(style.value as any).height}
								min="144"
								max="4320"
							/>
						</div>
					</div>
				</div>
			{:else if style.valueType === 'composite'}
				<div class="flex flex-col gap-2">
					{#each globalState.getVideoStyle
						.getStylesOfTarget(target!)
						.getCompositeStyles(style.id as StyleName) as subStyle}
						<StyleComponent
							style={subStyle}
							target={style.id}
							disabled={false}
							applyValueSimple={(v) => {
								subStyle.value = v;
							}}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
