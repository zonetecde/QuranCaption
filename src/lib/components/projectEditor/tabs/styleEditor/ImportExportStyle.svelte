<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { globalState } from '$lib/runes/main.svelte';
	import ExportFileService from '$lib/services/ExportFileService';
	import ModalManager from '$lib/components/modals/ModalManager';
	import Settings, { type SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
	import type { VideoStyleFileData } from '$lib/classes/VideoStyle.svelte';
	import {
		getCommunityPresetStyle,
		getPopularTags,
		getStyleLibraryDeviceId,
		likeCommunityPreset,
		listCommunityPresets,
		publishCommunityPreset,
		type CommunityPresetOrientation,
		type CommunityPresetSort,
		type CommunityPresetTag,
		type CommunityStylePreset
	} from '$lib/services/StylePresetLibraryService';
	import StylePresetSaveExportModal from './StylePresetSaveExportModal.svelte';
	import toast from 'svelte-5-french-toast';

	type ModalMode = 'save' | 'export';
	type DimensionValue = { width: number; height: number };

	let { onBack }: { onBack: () => void } = $props();
	let localSearchQuery = $state('');
	let communitySearchQuery = $state('');
	let selectedTag = $state('');
	let selectedOrientation = $state<CommunityPresetOrientation | 'all'>('all');
	let selectedSort = $state<CommunityPresetSort>('most_liked');
	let modalMode: ModalMode | null = $state(null);
	let communityPresets = $state<CommunityStylePreset[]>([]);
	let popularTags = $state<CommunityPresetTag[]>([]);
	let isLoadingCommunity = $state(false);
	let communityError = $state<string | null>(null);
	let downloadingPresetId = $state<string | null>(null);
	let likingPresetId = $state<string | null>(null);
	let likedPresetIds = $state(new Set<string>());
	let publishMode = $state(false);
	let publishName = $state('');
	let publishAuthorName = $state('');
	let publishDescription = $state('');
	let publishTags = $state('');
	let publishPreviewBlob = $state<Blob | null>(null);
	let publishPreviewUrl = $state('');
	let publishError = $state<string | null>(null);
	let isGeneratingPreview = $state(false);
	let isPublishing = $state(false);
	let lastPreviewClipId = $state<number | null>(null);
	let includedCustomClipIds = $state(new Set<number>());
	let lastCapturedInclusion = $state<Set<number> | null>(null);

	let setsEqual = (a: Set<number>, b: Set<number>) =>
		a.size === b.size && [...a].every((id) => b.has(id));

	let inclusionChanged = $derived(
		() => lastCapturedInclusion !== null && !setsEqual(lastCapturedInclusion, includedCustomClipIds)
	);

	let presets = $derived(() => globalState.settings?.savedVideoStylePresets ?? []);
	let filteredLocalPresets = $derived(() => {
		const query = localSearchQuery.trim().toLowerCase();
		if (!query) return presets();
		return presets().filter((preset) => preset.name.toLowerCase().includes(query));
	});
	let communityQueryKey = $derived(
		() => `${communitySearchQuery}|${selectedTag}|${selectedOrientation}|${selectedSort}`
	);
	let canPublish = $derived(
		() =>
			publishName.trim().length > 0 &&
			publishAuthorName.trim().length > 0 &&
			publishPreviewBlob !== null &&
			!isGeneratingPreview &&
			!isPublishing &&
			!inclusionChanged()
	);

	onMount(() => {
		void loadPopularTags();
		void loadCommunity();
	});

	onDestroy(() => {
		if (publishPreviewUrl) URL.revokeObjectURL(publishPreviewUrl);
	});

	$effect(() => {
		communityQueryKey();
		const timeout = setTimeout(() => {
			void loadCommunity();
		}, 250);
		return () => clearTimeout(timeout);
	});

	/** Opens the save/export modal. */
	function openStylePresetModal(mode: ModalMode): void {
		modalMode = mode;
	}

	/** Closes the save/export modal. */
	function closeStylePresetModal(): void {
		modalMode = null;
	}

	/** Opens the community publish form. */
	function openPublishForm(): void {
		publishMode = true;
		publishName = getDefaultPresetName();
		publishError = null;
		includedCustomClipIds = new Set();
		lastCapturedInclusion = null;
		if (!publishPreviewBlob) void generatePublishPreview();
	}

	/** Closes the community publish form. */
	function closePublishForm(): void {
		publishMode = false;
		publishError = null;
		lastPreviewClipId = null;
		includedCustomClipIds = new Set();
		lastCapturedInclusion = null;
	}

	/**
	 * Returns the current project video resolution.
	 *
	 * @returns {DimensionValue} Current video dimensions.
	 */
	function getCurrentResolution(): DimensionValue {
		const value = globalState.getStyle('global', 'video-dimension')?.value;
		if (
			typeof value === 'object' &&
			value !== null &&
			'width' in value &&
			'height' in value &&
			typeof (value as DimensionValue).width === 'number' &&
			typeof (value as DimensionValue).height === 'number'
		) {
			return value as DimensionValue;
		}

		return { width: 1920, height: 1080 };
	}

	/**
	 * Formats a video resolution for compact display.
	 *
	 * @param {DimensionValue} resolution Video dimensions.
	 * @returns {string} Human-readable resolution label.
	 */
	function getResolutionLabel(resolution: DimensionValue): string {
		const { width, height } = resolution;
		const minDimension = Math.min(width, height);
		const orientation = width >= height ? 'Landscape' : 'Portrait';
		const standardQualities: Record<number, string> = {
			720: '720p',
			1080: '1080p',
			1440: '1440p',
			2160: '2160p'
		};

		if (standardQualities[minDimension]) {
			return `${standardQualities[minDimension]} ${orientation}`;
		}

		return `${width}x${height}`;
	}

	/**
	 * Exports the current style data from the project.
	 *
	 * @param {Set<number>} includedClipIds Custom clip ids to include.
	 * @returns {VideoStyleFileData} Import-compatible style data.
	 */
	function buildStyleData(includedClipIds: Set<number>): VideoStyleFileData {
		return globalState.getVideoStyle.exportStylesData(includedClipIds);
	}

	/**
	 * Returns every custom clip id so published styles keep the visible overlays.
	 *
	 * @returns {Set<number>} Custom clip ids to export.
	 */
	function getAllCustomClipIds(): Set<number> {
		return includedCustomClipIds;
	}

	/**
	 * Returns a display label for a custom clip checkbox.
	 *
	 * @param {{ id: number; type: string; category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined } }} clip Custom clip.
	 * @returns {string} Human-readable label.
	 */
	function getClipLabel(clip: {
		id: number;
		type: string;
		category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined };
	}): string {
		if (clip.type === 'Custom Text') {
			const text = clip.category?.getStyle('text')?.value as string | undefined;
			return `Custom Text: ${text || clip.category?.name || 'Unnamed'}`;
		}
		const filepath = clip.category?.getStyle('filepath')?.value as string | undefined;
		const filename = filepath?.split(/[/\\]/).pop() || clip.category?.name || 'Unnamed';
		return `Custom Image: ${filename}`;
	}

	/**
	 * Toggles a custom clip id in the inclusion set and clears the last capture tracking.
	 *
	 * @param {number} id Clip id.
	 * @param {boolean} included Whether to include.
	 * @returns {void}
	 */
	function toggleCustomClip(id: number, included: boolean): void {
		const next = new Set(includedCustomClipIds);
		if (included) {
			next.add(id);
		} else {
			next.delete(id);
		}
		includedCustomClipIds = next;
	}

	/** All custom clips available for checkbox selection. */
	function getCustomClipsForUI(): {
		id: number;
		type: string;
		category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined };
	}[] {
		return globalState.getCustomClipTrack.clips.map((clip) => ({
			id: clip.id,
			type: clip.type,
			category: (
				clip as {
					category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined };
				}
			).category
		}));
	}

	/**
	 * Builds a local preset from the current project styles.
	 *
	 * @param {string} name Preset name.
	 * @param {Set<number>} includedClipIds Custom clip ids to include.
	 * @returns {SavedVideoStylePreset} Local preset payload.
	 */
	function buildPreset(name: string, includedClipIds: Set<number>): SavedVideoStylePreset {
		const now = new Date().toISOString();
		return {
			id: Date.now() + Math.floor(Math.random() * 1000),
			name,
			createdAt: now,
			updatedAt: now,
			resolution: getCurrentResolution(),
			data: buildStyleData(includedClipIds)
		};
	}

	/**
	 * Builds a local preset from a community preset and downloaded style data.
	 *
	 * @param {CommunityStylePreset} preset Community preset metadata.
	 * @param {VideoStyleFileData} data Downloaded style data.
	 * @returns {SavedVideoStylePreset} Local preset payload.
	 */
	function buildCommunityPreset(
		preset: CommunityStylePreset,
		data: VideoStyleFileData
	): SavedVideoStylePreset {
		const now = new Date().toISOString();
		return {
			id: Date.now() + Math.floor(Math.random() * 1000),
			communityPresetId: preset.id,
			name: preset.name,
			createdAt: now,
			updatedAt: now,
			resolution: preset.resolution,
			data
		};
	}

	/**
	 * Returns the default name used by save/export actions.
	 *
	 * @returns {string} Default preset name.
	 */
	function getDefaultPresetName(): string {
		const projectName = ExportFileService.getProjectNameForFile();
		return projectName ? `${projectName} style` : 'Video style';
	}

	/**
	 * Builds a safe filename for style JSON exports.
	 *
	 * @param {string} name Preset name.
	 * @returns {string} JSON export filename.
	 */
	function getExportFileName(name: string): string {
		const safeName = name
			.trim()
			.replace(/[<>:"/\\|?*]+/g, '-')
			.replace(/\s+/g, '_');
		return `exported_styles_${safeName || ExportFileService.getProjectNameForFile()}.json`;
	}

	/**
	 * Waits for the preview UI to render after seeking.
	 *
	 * @param {number} ms Delay in milliseconds.
	 * @returns {Promise<void>}
	 */
	function wait(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Parses the publish tags input into normalized tag names.
	 *
	 * @returns {string[]} Tags ready for the community API.
	 */
	function getPublishTags(): string[] {
		return [
			...new Set(
				publishTags
					.split(',')
					.map((tag) => tag.trim().toLowerCase())
					.filter(Boolean)
			)
		].slice(0, 12);
	}

	/**
	 * Picks a random timing at the middle of an existing subtitle clip.
	 *
	 * Avoids reusing the same clip as the previous preview when there
	 * is more than one subtitle available.
	 *
	 * @returns {number | null} Preview timing in milliseconds, or null when no subtitle exists.
	 */
	function getRandomSubtitlePreviewTime(): number | null {
		const clips = globalState.getSubtitleTrack.clips.filter(
			(clip) =>
				(clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle') &&
				clip.endTime > clip.startTime
		);
		if (clips.length === 0) return null;

		const candidates =
			clips.length > 1 && lastPreviewClipId !== null
				? clips.filter((clip) => clip.id !== lastPreviewClipId)
				: clips;

		const clip = candidates[Math.floor(Math.random() * candidates.length)];
		lastPreviewClipId = clip.id;
		const midTime = clip.startTime + (clip.endTime - clip.startTime) / 2;
		return Math.round(midTime);
	}

	/**
	 * Replaces the current publish preview image.
	 *
	 * @param {Blob} blob Generated preview image.
	 * @returns {void}
	 */
	function setPublishPreviewBlob(blob: Blob): void {
		if (publishPreviewUrl) URL.revokeObjectURL(publishPreviewUrl);
		publishPreviewBlob = blob;
		publishPreviewUrl = URL.createObjectURL(blob);
	}

	/**
	 * Generates a community preset preview from the video preview section.
	 *
	 * @returns {Promise<void>}
	 */
	async function generatePublishPreview(): Promise<void> {
		if (isGeneratingPreview) return;
		isGeneratingPreview = true;
		publishError = null;

		try {
			const timing = getRandomSubtitlePreviewTime();
			if (timing === null) {
				publishError = 'Add at least one subtitle before generating a preview image.';
				toast.error(publishError);
				return;
			}

			const wasFullscreen = globalState.getVideoPreviewState.isFullscreen;

			globalState.getTimelineState.cursorPosition = timing;
			globalState.getTimelineState.movePreviewTo = timing;
			globalState.updateVideoPreviewUI();

			const overlays = document.querySelectorAll<HTMLElement>('#preview .customtext');
			const saved = new Map<HTMLElement, string>();
			overlays.forEach((el) => {
				const clipId = Number(el.dataset.clipId);
				if (!includedCustomClipIds.has(clipId)) {
					saved.set(el, el.style.opacity);
					el.style.opacity = '0';
				}
			});

			await tick();
			await wait(350);

			if (!wasFullscreen) {
				await globalState.getVideoPreviewState.toggleFullScreen();
				await wait(500);
			}

			try {
				const bytes = new Uint8Array(await invoke<number[]>('capture_window_screenshot'));

				const blob = new Blob([bytes], { type: 'image/jpeg' });
				setPublishPreviewBlob(blob);
				lastCapturedInclusion = new Set(includedCustomClipIds);
			} finally {
				saved.forEach((opacity, element) => {
					element.style.opacity = opacity;
				});
			}

			if (!wasFullscreen) {
				await globalState.getVideoPreviewState.toggleFullScreen();
			}
		} catch (error) {
			publishError = error instanceof Error ? error.message : String(error);
			toast.error(publishError);
		} finally {
			isGeneratingPreview = false;
		}
	}

	/**
	 * Publishes the current style preset to the community library.
	 *
	 * @returns {Promise<void>}
	 */
	async function publishPreset(): Promise<void> {
		if (!canPublish() || !publishPreviewBlob) return;

		isPublishing = true;
		publishError = null;
		try {
			const preset = await publishCommunityPreset({
				name: publishName.trim(),
				authorName: publishAuthorName.trim(),
				description: publishDescription.trim(),
				tags: getPublishTags(),
				resolution: getCurrentResolution(),
				style: buildStyleData(getAllCustomClipIds()),
				preview: publishPreviewBlob
			});
			communityPresets = [preset, ...communityPresets.filter((item) => item.id !== preset.id)];
			void loadPopularTags();
			closePublishForm();
			toast.success('Community preset published.');
		} catch (error) {
			publishError = error instanceof Error ? error.message : String(error);
			toast.error(publishError);
		} finally {
			isPublishing = false;
		}
	}

	/**
	 * Inserts or replaces a local preset.
	 *
	 * @param {SavedVideoStylePreset} preset Preset to store.
	 * @returns {Promise<boolean>} True when the preset was stored.
	 */
	async function storeLocalPreset(preset: SavedVideoStylePreset): Promise<boolean> {
		const settings = globalState.settings ?? new Settings();
		if (!globalState.settings) globalState.settings = settings;

		const existingIndex = settings.savedVideoStylePresets.findIndex(
			(item) =>
				(preset.communityPresetId && item.communityPresetId === preset.communityPresetId) ||
				item.name.trim().toLowerCase() === preset.name.trim().toLowerCase()
		);
		const nextPresets = [...settings.savedVideoStylePresets];

		if (existingIndex !== -1) {
			const confirmed = await ModalManager.confirmModal(
				`A preset named "${preset.name}" already exists. Replace it?`,
				false
			);
			if (!confirmed) return false;

			const existing = nextPresets[existingIndex];
			nextPresets.splice(existingIndex, 1, {
				...preset,
				id: existing.id,
				createdAt: existing.createdAt
			});
		} else {
			nextPresets.unshift(preset);
		}

		settings.savedVideoStylePresets = nextPresets;
		await Settings.save();
		return true;
	}

	/**
	 * Saves the current project styles as a local preset.
	 *
	 * @param {string} name Preset name.
	 * @param {Set<number>} includedClipIds Custom clip ids to include.
	 * @returns {Promise<void>}
	 */
	async function savePreset(name: string, includedClipIds: Set<number>): Promise<void> {
		const stored = await storeLocalPreset(buildPreset(name.trim(), includedClipIds));
		if (!stored) return;
		closeStylePresetModal();
		toast.success('Style preset saved.');
	}

	/**
	 * Exports current project styles to a JSON file.
	 *
	 * @param {string} name Preset name.
	 * @param {Set<number>} includedClipIds Custom clip ids to include.
	 * @returns {Promise<void>}
	 */
	async function exportJson(name: string, includedClipIds: Set<number>): Promise<void> {
		const json = JSON.stringify(buildStyleData(includedClipIds), null, 2);
		await ExportFileService.saveTextFile(getExportFileName(name), json, 'Styles');
		closeStylePresetModal();
		toast.success('Style JSON exported.');
	}

	/**
	 * Applies a saved local preset to the current project.
	 *
	 * @param {SavedVideoStylePreset} preset Local preset to apply.
	 * @returns {Promise<void>}
	 */
	async function applyPreset(preset: SavedVideoStylePreset): Promise<void> {
		const confirmed = await ModalManager.confirmModal(
			`Your current styles will be overwritten by "${preset.name}".`,
			false
		);
		if (!confirmed) return;

		await globalState.getVideoStyle.importStyles(preset.data);
		toast.success('Style preset applied.');
	}

	/**
	 * Deletes a saved local preset.
	 *
	 * @param {SavedVideoStylePreset} preset Local preset to delete.
	 * @returns {Promise<void>}
	 */
	async function deletePreset(preset: SavedVideoStylePreset): Promise<void> {
		const confirmed = await ModalManager.confirmModal(`Delete "${preset.name}"?`, false);
		if (!confirmed || !globalState.settings) return;

		globalState.settings.savedVideoStylePresets =
			globalState.settings.savedVideoStylePresets.filter((item) => item.id !== preset.id);
		await Settings.save();
		toast.success('Style preset deleted.');
	}

	/**
	 * Loads community presets from the public API.
	 *
	 * @returns {Promise<void>}
	 */
	async function loadCommunity(): Promise<void> {
		isLoadingCommunity = true;
		communityError = null;
		try {
			communityPresets = await listCommunityPresets({
				search: communitySearchQuery,
				tag: selectedTag,
				orientation: selectedOrientation,
				sort: selectedSort,
				limit: 100
			});
		} catch (error) {
			communityError = error instanceof Error ? error.message : String(error);
			communityPresets = [];
		} finally {
			isLoadingCommunity = false;
		}
	}

	/**
	 * Loads popular community tags from the public API.
	 *
	 * @returns {Promise<void>}
	 */
	async function loadPopularTags(): Promise<void> {
		try {
			popularTags = await getPopularTags();
		} catch {
			popularTags = [];
		}
	}

	/**
	 * Checks fonts used by a style preset and returns any that are missing
	 * from the user's system.
	 *
	 * Fonts bundled with the app (QPC1, QPC2, Hafs, IndoPak, etc.) are skipped
	 * since every user has them.
	 *
	 * @param {VideoStyleFileData} styleData The imported preset style data.
	 * @returns {Promise<string[]>} Font names the user should install.
	 */
	async function checkMissingFonts(styleData: VideoStyleFileData): Promise<string[]> {
		const fonts = new Set<string>();

		const videoStyle = styleData.videoStyle as {
			styles?: { categories?: { styles?: { id: string; value: string }[] }[] }[];
		};
		for (const styleGroup of videoStyle.styles ?? []) {
			for (const category of styleGroup.categories ?? []) {
				for (const style of category.styles ?? []) {
					if (style.id === 'font-family' && typeof style.value === 'string') {
						fonts.add(style.value);
					}
				}
			}
		}

		const builtin = ['Hafs', 'IndoPak', 'Reciters', 'Surahs', 'QPC1BSML', 'QPC2BSML'];
		const isBuiltin = (font: string) =>
			builtin.includes(font) ||
			font.startsWith('QPC1') ||
			font.startsWith('QPC2') ||
			/^p\d+-v4$/.test(font);

		const toCheck = [...fonts].filter((f) => !isBuiltin(f));
		if (toCheck.length === 0) return [];

		const systemFonts = await invoke<string[]>('get_system_fonts');
		return toCheck.filter((f) => !systemFonts.includes(f));
	}

	/**
	 * Downloads, stores, and applies a community preset.
	 *
	 * @param {CommunityStylePreset} preset Community preset metadata.
	 * @returns {Promise<void>}
	 */
	async function downloadAndApplyCommunityPreset(preset: CommunityStylePreset): Promise<void> {
		if (downloadingPresetId) return;
		const confirmed = await ModalManager.confirmModal(
			`Your current styles will be overwritten by "${preset.name}".`,
			false
		);
		if (!confirmed) return;

		downloadingPresetId = preset.id;
		try {
			const styleData = await getCommunityPresetStyle(preset.id);
			const stored = await storeLocalPreset(buildCommunityPreset(preset, styleData));
			if (!stored) return;

			await globalState.getVideoStyle.importStyles(styleData);
			communityPresets = communityPresets.map((item) =>
				item.id === preset.id ? { ...item, downloadCount: item.downloadCount + 1 } : item
			);
			toast.success('Community preset saved and applied.');

			const missing = await checkMissingFonts(styleData);
			if (missing.length > 0) {
				await ModalManager.confirmModal(
					`This preset uses fonts that are not installed on your system:\n\n${missing.map((f) => `• ${f}`).join('\n')}\n\nPlease download and install the missing ${missing.length === 1 ? 'font' : 'fonts'}, then restart QuranCaption for them to take effect.`,
					false
				);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			downloadingPresetId = null;
		}
	}

	/**
	 * Likes a community preset for the current device.
	 *
	 * @param {CommunityStylePreset} preset Community preset metadata.
	 * @returns {Promise<void>}
	 */
	async function likePreset(preset: CommunityStylePreset): Promise<void> {
		if (likingPresetId || likedPresetIds.has(preset.id)) return;
		likingPresetId = preset.id;
		try {
			const deviceId = await getStyleLibraryDeviceId();
			const result = await likeCommunityPreset(preset.id, deviceId);
			likedPresetIds = new Set(likedPresetIds).add(preset.id);
			communityPresets = communityPresets.map((item) =>
				item.id === preset.id ? { ...item, likeCount: result.likeCount } : item
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			likingPresetId = null;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="flex items-center gap-3 border-b border-color px-4 py-3">
		<button
			class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-primary hover:text-primary"
			type="button"
			onclick={() => (publishMode ? closePublishForm() : onBack())}
			aria-label={publishMode ? 'Back to style presets' : 'Back to style editor'}
		>
			<span class="material-icons-outlined text-lg">arrow_back</span>
		</button>
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-lg font-semibold text-primary">
				{publishMode ? 'Publish preset' : 'Style presets'}
			</h2>
			<p class="text-xs text-secondary">
				{publishMode ? 'Share this style with the community' : 'Local library and community styles'}
			</p>
		</div>
		{#if !publishMode}
			<div class="flex items-center gap-2">
				<button
					class="btn flex h-9 items-center gap-2 px-3 text-sm font-medium"
					type="button"
					onclick={openPublishForm}
				>
					<span class="material-icons-outlined text-base">cloud_upload</span>
					Publish
				</button>
				<button
					class="btn-accent flex h-9 items-center gap-2 px-3 text-sm font-medium"
					type="button"
					onclick={() => openStylePresetModal('save')}
				>
					<span class="material-icons-outlined text-base">add</span>
					Save
				</button>
			</div>
		{/if}
	</div>

	{#if publishMode}
		<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
			<section class="space-y-4">
				<div class="overflow-hidden rounded-lg border border-color bg-primary/50">
					<div class="aspect-video bg-black/40">
						{#if publishPreviewUrl}
							<img
								class="h-full w-full object-cover"
								src={publishPreviewUrl}
								alt="Community preset preview"
							/>
						{:else}
							<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
								<span class="material-icons-outlined text-2xl text-thirdly">
									add_photo_alternate
								</span>
								<p class="px-4 text-xs text-thirdly">
									Generate a preview from a random subtitle in the video preview.
								</p>
							</div>
						{/if}
					</div>
					<div class="flex items-center justify-between gap-3 border-t border-color p-3">
						<p class="min-w-0 text-xs text-secondary">
							{publishPreviewBlob
								? 'Preview ready. Regenerate to try another subtitle moment.'
								: 'A subtitle is required to generate a preview.'}
						</p>
						<button
							class="btn shrink-0 px-3 py-1.5 text-xs"
							type="button"
							onclick={generatePublishPreview}
							disabled={isGeneratingPreview}
						>
							{isGeneratingPreview ? 'Generating...' : 'Regenerate'}
						</button>
					</div>
				</div>

				<div class="space-y-3">
					<label class="block space-y-1.5">
						<span class="text-xs font-medium text-secondary">Name</span>
						<input
							bind:value={publishName}
							class="h-9 w-full rounded-md border border-color bg-primary px-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
							type="text"
							maxlength="120"
							placeholder="Clean Quran style"
						/>
					</label>
					<label class="block space-y-1.5">
						<span class="text-xs font-medium text-secondary">Author</span>
						<input
							bind:value={publishAuthorName}
							class="h-9 w-full rounded-md border border-color bg-primary px-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
							type="text"
							maxlength="120"
							placeholder="Your name"
						/>
					</label>
					<label class="block space-y-1.5">
						<span class="text-xs font-medium text-secondary"
							>Tags <span class="font-normal text-thirdly">(optional)</span></span
						>
						<input
							bind:value={publishTags}
							class="h-9 w-full rounded-md border border-color bg-primary px-3 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
							type="text"
							placeholder="clean, subtitle, bold"
						/>
					</label>
					<label class="block space-y-1.5">
						<span class="text-xs font-medium text-secondary"
							>Description <span class="font-normal text-thirdly">(optional)</span></span
						>
						<textarea
							bind:value={publishDescription}
							class="min-h-20 w-full resize-none rounded-md border border-color bg-primary px-3 py-2 text-sm text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
							maxlength="600"
							placeholder="Shortly describe where this style works best."
						></textarea>
					</label>
				</div>

				{#if getCustomClipsForUI().length > 0}
					<div class="space-y-2 rounded-lg border border-color bg-primary/50 px-3 py-3">
						<span class="text-xs font-medium text-secondary">Style overlays to include</span>
						<p class="text-xs text-thirdly">
							Custom images are NOT bundled — users must replace them with their own image.
						</p>
						{#each getCustomClipsForUI() as clip (clip.id)}
							{@const label = getClipLabel(clip)}
							<label class="flex items-start gap-2 cursor-pointer select-none">
								<input
									type="checkbox"
									class="mt-0.5 accent-[var(--accent-primary)]"
									checked={includedCustomClipIds.has(clip.id)}
									onclick={(e) => toggleCustomClip(clip.id, e.currentTarget.checked)}
								/>
								<span class="text-sm text-primary">{label}</span>
							</label>
						{/each}
					</div>
				{/if}

				{#if inclusionChanged()}
					<div
						class="rounded-lg border border-yellow-400/35 bg-yellow-500/10 px-3 py-3 text-sm text-yellow-100"
					>
						<div class="flex items-start gap-2">
							<span class="material-icons-outlined text-base">refresh</span>
							<p class="min-w-0 flex-1 text-xs">Regenerate the preview before publishing.</p>
						</div>
					</div>
				{/if}

				{#if publishError}
					<div
						class="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-3 text-sm text-red-100"
					>
						<div class="flex items-start gap-2">
							<span class="material-icons-outlined text-base">error</span>
							<p class="min-w-0 flex-1 text-xs">{publishError}</p>
						</div>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-2 border-t border-color pt-4">
					<button class="btn px-3 py-2 text-sm" type="button" onclick={closePublishForm}>
						Cancel
					</button>
					<button
						class="btn-accent px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
						type="button"
						onclick={publishPreset}
						disabled={!canPublish()}
					>
						{isPublishing ? 'Publishing...' : 'Publish preset'}
					</button>
				</div>
			</section>
		</div>
	{:else}
		<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
			<section class="space-y-3">
				<div class="flex items-center justify-between gap-3">
					<div>
						<h3 class="text-sm font-semibold text-primary">Saved presets</h3>
						<p class="text-xs text-secondary">
							{presets().length} local preset{presets().length === 1 ? '' : 's'}
						</p>
					</div>
					<div class="flex items-center gap-3 text-[11px]">
						<button
							class="text-thirdly underline underline-offset-2 transition-colors hover:text-primary"
							type="button"
							onclick={() => globalState.getVideoStyle.importStylesFromFile()}
						>
							Choose file
						</button>
						<button
							class="text-thirdly underline underline-offset-2 transition-colors hover:text-primary"
							type="button"
							onclick={() => openStylePresetModal('export')}
						>
							Export file
						</button>
						<button
							class="text-thirdly underline underline-offset-2 transition-colors hover:text-primary"
							type="button"
							onclick={() => globalState.getVideoStyle.resetStyles()}
						>
							Reset
						</button>
					</div>
				</div>

				<label class="relative block">
					<span
						class="material-icons-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
					>
						search
					</span>
					<input
						bind:value={localSearchQuery}
						class="h-9 w-full rounded-md border border-color bg-primary py-1 pl-8 pr-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
						type="search"
						placeholder="Search saved presets"
					/>
				</label>

				<div class="max-h-44 overflow-y-auto rounded-lg border border-color bg-primary/40 p-1">
					{#if filteredLocalPresets().length === 0}
						<div class="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
							<span class="material-icons-outlined text-xl text-thirdly">folder_open</span>
							<p class="text-xs text-thirdly">
								{presets().length === 0 ? 'No saved presets' : 'No saved presets found'}
							</p>
						</div>
					{:else}
						<div class="space-y-1">
							{#each filteredLocalPresets() as preset (preset.id)}
								<div
									class="group flex min-h-10 w-full items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-black/30"
								>
									<button
										class="flex min-w-0 flex-1 items-center gap-2 rounded py-1 pr-1 text-left focus:outline-none"
										type="button"
										onclick={() => applyPreset(preset)}
										title={preset.name}
									>
										<span
											class="material-icons-outlined shrink-0 text-base! text-secondary group-hover:text-primary"
										>
											description
										</span>
										<span class="min-w-0 flex-1 truncate text-xs font-medium text-primary">
											{preset.name}
										</span>
										<span
											class="shrink-0 rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] leading-4 text-secondary"
										>
											{getResolutionLabel(preset.resolution)}
										</span>
									</button>
									<button
										class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-thirdly opacity-70 transition-colors hover:bg-red-500/15 hover:text-red-400 group-hover:opacity-100"
										type="button"
										title="Delete preset"
										onclick={() => deletePreset(preset)}
									>
										<span class="material-icons-outlined text-sm">delete</span>
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</section>

			<section class="space-y-3 border-t border-color pt-4">
				<div>
					<h3 class="text-sm font-semibold text-primary">Community presets</h3>
					<p class="text-xs text-secondary">
						Download a shared style to save and apply it locally.
					</p>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<label class="relative col-span-2 block">
						<span
							class="material-icons-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
						>
							search
						</span>
						<input
							bind:value={communitySearchQuery}
							class="h-9 w-full rounded-md border border-color bg-primary py-1 pl-8 pr-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
							type="search"
							placeholder="Search community presets"
						/>
					</label>
					<select bind:value={selectedSort} class="h-9 text-xs">
						<option value="newest">Newest</option>
						<option value="most_downloaded">Most downloaded</option>
						<option value="most_liked">Most liked</option>
					</select>
					<select bind:value={selectedOrientation} class="h-9 text-xs">
						<option value="all">All orientations</option>
						<option value="landscape">Landscape</option>
						<option value="portrait">Portrait</option>
						<option value="square">Square</option>
					</select>
				</div>

				{#if popularTags.length > 0}
					<div class="flex gap-1.5 overflow-x-auto pb-1">
						<button
							class={(selectedTag === '' ? 'btn-accent' : 'btn') + ' shrink-0 px-2 py-1 text-xs'}
							type="button"
							onclick={() => (selectedTag = '')}
						>
							All tags
						</button>
						{#each popularTags as tag (tag.name)}
							<button
								class={(selectedTag === tag.name ? 'btn-accent' : 'btn') +
									' shrink-0 px-2 py-1 text-xs'}
								type="button"
								onclick={() => (selectedTag = tag.name)}
							>
								{tag.name} ({tag.count})
							</button>
						{/each}
					</div>
				{/if}

				{#if communityError}
					<div
						class="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-3 text-sm text-red-100"
					>
						<div class="flex items-start gap-2">
							<span class="material-icons-outlined text-base">error</span>
							<div class="min-w-0 flex-1">
								<p class="font-medium">Unable to load community presets</p>
								<p class="mt-0.5 text-xs text-red-100/80">{communityError}</p>
							</div>
							<button class="btn px-2 py-1 text-xs" type="button" onclick={() => loadCommunity()}>
								Retry
							</button>
						</div>
					</div>
				{:else if isLoadingCommunity}
					<div class="grid grid-cols-2 gap-3">
						{#each Array(4) as _, index (index)}
							<div class="h-44 animate-pulse rounded-lg border border-color bg-primary/50"></div>
						{/each}
					</div>
				{:else if communityPresets.length === 0}
					<div
						class="flex flex-col items-center justify-center gap-2 rounded-lg border border-color bg-primary/40 px-4 py-10 text-center"
					>
						<span class="material-icons-outlined text-2xl text-thirdly">travel_explore</span>
						<p class="text-sm font-medium text-primary">No community presets found</p>
						<p class="text-xs text-thirdly">Try another search, tag, or orientation.</p>
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-3">
						{#each communityPresets as preset (preset.id)}
							<article class="group overflow-hidden rounded-lg border border-color bg-primary/50">
								<button
									class="block w-full text-left"
									type="button"
									onclick={() => downloadAndApplyCommunityPreset(preset)}
									disabled={downloadingPresetId !== null}
								>
									<div class="relative aspect-video w-full overflow-hidden bg-black/30">
										<img
											class="h-full w-full object-cover"
											src={preset.previewUrl}
											alt={preset.name}
											loading="lazy"
										/>
										{#if preset.description}
											<div
												class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity group-hover:opacity-100"
											>
												<p class="line-clamp-2 text-[11px] leading-tight text-white/90">
													{preset.description}
												</p>
											</div>
										{/if}
									</div>
									<div class="space-y-2 p-2">
										<div class="min-w-0">
											<h4 class="truncate text-sm font-semibold text-primary">{preset.name}</h4>
											<p class="truncate text-xs text-secondary">by {preset.authorName}</p>
										</div>
										<div class="flex flex-wrap gap-1">
											<span
												class="rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] text-secondary"
											>
												{preset.orientation}
											</span>
											<span
												class="rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] text-secondary"
											>
												{getResolutionLabel(preset.resolution)}
											</span>
										</div>
										<div class="min-h-[18px]">
											{#if preset.tags.length > 0}
												<div class="flex gap-1 overflow-hidden">
													{#each preset.tags.slice(0, 3) as tag (tag)}
														<span
															class="truncate rounded bg-black/25 px-1.5 py-0.5 text-[10px] text-thirdly"
														>
															#{tag}
														</span>
													{/each}
												</div>
											{/if}
										</div>
									</div>
								</button>
								<div
									class="flex items-center justify-between border-t border-color px-2 py-1.5 text-xs text-secondary"
								>
									<div class="flex items-center gap-2">
										<span class="inline-flex items-center gap-1">
											<span class="material-icons-outlined text-sm">download</span>
											{preset.downloadCount}
										</span>
										<span class="inline-flex items-center gap-1">
											<span class="material-icons-outlined text-sm">favorite</span>
											{preset.likeCount}
										</span>
									</div>
									<div class="flex items-center gap-0.5">
										<button
											class={(likedPresetIds.has(preset.id)
												? 'text-red-400'
												: 'text-thirdly hover:text-red-400') +
												' flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-red-500/10 disabled:opacity-60'}
											type="button"
											title="Like preset"
											disabled={likingPresetId !== null || likedPresetIds.has(preset.id)}
											onclick={() => likePreset(preset)}
										>
											<span class="material-icons-outlined text-base">
												{likingPresetId === preset.id ? 'hourglass_empty' : 'favorite'}
											</span>
										</button>

										<button
											class="flex h-7 w-7 items-center justify-center rounded text-thirdly transition-colors hover:bg-primary hover:text-primary disabled:opacity-60"
											type="button"
											title="Download and apply"
											disabled={downloadingPresetId !== null}
											onclick={(e: MouseEvent) => {
												e.stopPropagation();
												downloadAndApplyCommunityPreset(preset);
											}}
										>
											<span class="material-icons-outlined text-[27px]!">download</span>
										</button>
									</div>
								</div>
							</article>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

{#if modalMode}
	<div
		class="style-preset-modal modal-wrapper"
		onmousedown={(event) => {
			if (event.target === event.currentTarget) closeStylePresetModal();
		}}
	>
		<StylePresetSaveExportModal
			mode={modalMode}
			defaultName={getDefaultPresetName()}
			close={closeStylePresetModal}
			onSavePreset={savePreset}
			onExportJson={exportJson}
		/>
	</div>
{/if}
