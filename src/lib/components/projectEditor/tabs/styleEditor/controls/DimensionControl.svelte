<script lang="ts">
	import type { DimensionValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import LL from '$lib/i18n/i18n-svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { asDimensionValue } from './utils';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();
	let selectedOrientation = $state('landscape');
	let selectedQuality = $state('1080p');
	let orientations = $derived([
		{
			value: 'landscape',
			ratio: '16:9',
			icon: 'crop_landscape',
			label: $LL.style.orientationLandscape()
		},
		{
			value: 'portrait',
			ratio: '9:16',
			icon: 'crop_portrait',
			label: $LL.style.orientationPortrait()
		},
		{
			value: 'square',
			ratio: '1:1',
			icon: 'crop_square',
			label: $LL.style.orientationSquare()
		},
		{
			value: 'custom',
			ratio: 'W×H',
			icon: 'tune',
			label: $LL.export.customDimensions()
		}
	]);
	const qualities = [
		{ value: '720p', label: '720p' },
		{ value: '1080p', label: '1080p' },
		{ value: '1440p', label: '1440p (2K)' },
		{ value: '2160p', label: '2160p (4K)' }
	];
	let dimensionCopy = $derived(
		$LL.export as unknown as {
			orientation: () => string;
			quality: () => string;
			customDimensions: () => string;
		}
	);

	$effect(() => {
		const dimensions = asDimensionValue(value);
		const maxDimension = Math.max(dimensions.width, dimensions.height);
		const minDimension = Math.min(dimensions.width, dimensions.height);
		const quality = qualities.find(({ value: candidate }) => {
			const preset = getDimensions('landscape', candidate);
			return dimensions.width === dimensions.height
				? dimensions.width === preset.height
				: maxDimension === preset.width && minDimension === preset.height;
		});

		if (!quality) {
			selectedOrientation = 'custom';
			return;
		}
		selectedQuality = quality.value;
		if (dimensions.width === dimensions.height) selectedOrientation = 'square';
		else selectedOrientation = dimensions.width > dimensions.height ? 'landscape' : 'portrait';
	});

	/**
	 * Résout les dimensions d'une qualité et d'une orientation.
	 * @param {string} orientation Orientation paysage ou portrait.
	 * @param {string} quality Qualité vidéo sélectionnée.
	 * @returns {DimensionValue} Dimensions correspondantes.
	 */
	function getDimensions(orientation: string, quality: string): DimensionValue {
		const dimensions: Record<string, [number, number]> = {
			'720p': [1280, 720],
			'1080p': [1920, 1080],
			'1440p': [2560, 1440],
			'2160p': [3840, 2160]
		};
		const [width, height] = dimensions[quality] ?? dimensions['1080p'];
		if (orientation === 'portrait') return { width: height, height: width };
		if (orientation === 'square') return { width: height, height };
		if (orientation === 'custom') return asDimensionValue(value);
		return { width, height };
	}

	/**
	 * Retourne la résolution affichée sur le bouton d'application.
	 * @returns {string} Résolution au format largeur × hauteur.
	 */
	function getPreviewResolution(): string {
		const dimensions = getDimensions(selectedOrientation, selectedQuality);
		return `${dimensions.width}×${dimensions.height}`;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">{dimensionCopy.orientation()}:</p>
		<div class="grid grid-cols-4 gap-2">
			{#each orientations as orientation (orientation.value)}
				<button
					type="button"
					data-orientation={orientation.value}
					aria-pressed={selectedOrientation === orientation.value}
					class="flex min-h-20 flex-col items-center justify-center gap-0.5 rounded-xl border p-2 transition-all {selectedOrientation ===
					orientation.value
						? 'border-accent-primary bg-accent text-accent-primary'
						: 'border-color bg-primary text-secondary hover:border-accent-primary hover:text-primary'}"
					onclick={() => (selectedOrientation = orientation.value)}
				>
					<span class="material-icons text-2xl">{orientation.icon}</span>
					<span class="text-xs font-semibold text-primary">{orientation.ratio}</span>
					<span class="max-w-full break-words text-xs">{orientation.label}</span>
				</button>
			{/each}
		</div>
	</div>

	{#if selectedOrientation === 'custom'}
		<div class="flex flex-col gap-1.5">
			<p class="text-sm font-medium">{dimensionCopy.customDimensions()}:</p>
			<div class="flex flex-row items-center gap-2">
				<input
					data-custom-dimension
					type="number"
					class="w-full"
					oninput={(event) =>
						onChange({
							width: parseInt((event.target as HTMLInputElement).value),
							height: asDimensionValue(value).height
						})}
					value={asDimensionValue(value).width}
					min="256"
					max="7680"
				/>
				<span>×</span>
				<input
					data-custom-dimension
					type="number"
					class="w-full"
					oninput={(event) =>
						onChange({
							width: asDimensionValue(value).width,
							height: parseInt((event.target as HTMLInputElement).value)
						})}
					value={asDimensionValue(value).height}
					min="144"
					max="4320"
				/>
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			<p class="text-sm font-medium">{dimensionCopy.quality()}:</p>
			<div class="grid grid-cols-2 gap-2">
				{#each qualities as quality (quality.value)}
					<button
						type="button"
						data-quality={quality.value}
						aria-pressed={selectedQuality === quality.value}
						class="rounded-lg border px-2 py-2 text-xs font-medium transition-all {selectedQuality ===
						quality.value
							? 'border-accent-primary bg-accent text-accent-primary'
							: 'border-color text-secondary hover:border-accent-primary hover:text-primary'}"
						onclick={() => (selectedQuality = quality.value)}
					>
						{quality.label}
					</button>
				{/each}
			</div>
		</div>

		<button
			data-apply-dimensions
			class="btn-accent w-full py-2"
			onclick={() => onChange(getDimensions(selectedOrientation, selectedQuality))}
			disabled={!selectedOrientation || !selectedQuality}
		>
			{$LL.common.apply()}
			{getPreviewResolution()}
		</button>
	{/if}
</div>
