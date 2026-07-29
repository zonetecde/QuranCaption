<script lang="ts">
	import type { DimensionValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { asDimensionValue } from './utils';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();
	let selectedOrientation = $state('landscape');
	let selectedQuality = $state('1080p');

	$effect(() => {
		const dimensions = asDimensionValue(value);
		selectedOrientation = dimensions.width > dimensions.height ? 'landscape' : 'portrait';
		const maxDimension = Math.max(dimensions.width, dimensions.height);
		const minDimension = Math.min(dimensions.width, dimensions.height);

		if (maxDimension === 3840 && minDimension === 2160) selectedQuality = '2160p';
		else if (maxDimension === 2560 && minDimension === 1440) selectedQuality = '1440p';
		else if (maxDimension === 1920 && minDimension === 1080) selectedQuality = '1080p';
		else if (maxDimension === 1280 && minDimension === 720) selectedQuality = '720p';
		else if (maxDimension >= 3000) selectedQuality = '2160p';
		else if (maxDimension >= 2000) selectedQuality = '1440p';
		else if (maxDimension >= 1500) selectedQuality = '1080p';
		else selectedQuality = '720p';
	});

	/**
	 * Résout les dimensions d'une qualité et d'une orientation.
	 * @param {string} orientation Orientation paysage ou portrait.
	 * @param {string} quality Qualité vidéo sélectionnée.
	 * @returns {DimensionValue} Dimensions correspondantes.
	 */
	function getDimensions(orientation: string, quality: string): DimensionValue {
		const landscape = orientation === 'landscape';
		const dimensions: Record<string, [number, number]> = {
			'720p': [1280, 720],
			'1080p': [1920, 1080],
			'1440p': [2560, 1440],
			'2160p': [3840, 2160]
		};
		const [width, height] = dimensions[quality] ?? dimensions['1080p'];
		return landscape ? { width, height } : { width: height, height: width };
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

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">Orientation:</p>
		<div class="flex gap-4">
			{#each [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }] as orientation (orientation.value)}
				<label class="flex cursor-pointer items-center gap-2">
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

	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">Quality:</p>
		<div class="flex flex-wrap gap-4">
			{#each [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p (2K)' }, { value: '2160p', label: '2160p (4K)' }] as quality (quality.value)}
				<label class="flex cursor-pointer items-center gap-2">
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

	<button
		class="btn-accent mt-2 w-full py-2"
		onclick={() => onChange(getDimensions(selectedOrientation, selectedQuality))}
		disabled={!selectedOrientation || !selectedQuality}
	>
		Apply {getPreviewResolution()}
	</button>

	<div class="flex flex-col gap-2">
		<p class="text-sm font-medium">Custom dimensions:</p>
		<div class="flex flex-row items-center gap-x-2">
			<input
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
</div>
