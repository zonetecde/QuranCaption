import { env } from '$env/dynamic/public';
import Settings from '$lib/classes/Settings.svelte';
import type { VideoStyleFileData } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';

const DEFAULT_STYLE_LIBRARY_API_BASE_URL = 'https://api.qurancaption.com';

export type CommunityPresetOrientation = 'landscape' | 'portrait' | 'square';
export type CommunityPresetSort = 'newest' | 'most_downloaded' | 'most_liked';

export type CommunityStylePreset = {
	id: string;
	name: string;
	authorName: string;
	description: string;
	tags: string[];
	resolution: { width: number; height: number };
	orientation: CommunityPresetOrientation;
	previewUrl: string;
	downloadCount: number;
	likeCount: number;
	createdAt: string;
	updatedAt: string;
};

export type CommunityPresetTag = {
	name: string;
	count: number;
};

export type CommunityPresetListParams = {
	search?: string;
	tag?: string;
	orientation?: CommunityPresetOrientation | 'all';
	sort?: CommunityPresetSort;
	limit?: number;
	offset?: number;
};

export type PublishCommunityPresetParams = {
	name: string;
	authorName: string;
	description?: string;
	tags?: string[];
	resolution: { width: number; height: number };
	style: VideoStyleFileData;
	preview: Blob;
};

/**
 * Returns the configured style library API base URL.
 *
 * @returns {string} Base URL without a trailing slash.
 */
function getApiBaseUrl(): string {
	return (
		env.PUBLIC_STYLE_LIBRARY_API_BASE_URL?.trim() || DEFAULT_STYLE_LIBRARY_API_BASE_URL
	).replace(/\/+$/, '');
}

/**
 * Builds a style library API URL.
 *
 * @param {string} path API path starting with a slash.
 * @returns {URL} Absolute API URL.
 */
function buildApiUrl(path: string): URL {
	return new URL(`${getApiBaseUrl()}${path}`);
}

/**
 * Throws an actionable error for non-2xx API responses.
 *
 * @param {Response} response Fetch response.
 * @returns {Promise<void>}
 */
async function assertOk(response: Response): Promise<void> {
	if (response.ok) return;
	let message = `Style library API returned ${response.status}.`;
	try {
		const body = (await response.json()) as { error?: string };
		if (body.error) message = body.error;
	} catch {
		// Keep the status-based message when the response is not JSON.
	}
	throw new Error(message);
}

/**
 * Lists public community style presets.
 *
 * @param {CommunityPresetListParams} params Query filters and pagination.
 * @returns {Promise<CommunityStylePreset[]>} Matching community presets.
 */
export async function listCommunityPresets(
	params: CommunityPresetListParams = {}
): Promise<CommunityStylePreset[]> {
	const url = buildApiUrl('/presets');
	if (params.search?.trim()) url.searchParams.set('search', params.search.trim());
	if (params.tag?.trim()) url.searchParams.set('tag', params.tag.trim());
	if (params.orientation && params.orientation !== 'all') {
		url.searchParams.set('orientation', params.orientation);
	}
	if (params.sort) url.searchParams.set('sort', params.sort);
	url.searchParams.set('limit', String(params.limit ?? 100));
	url.searchParams.set('offset', String(params.offset ?? 0));

	const response = await fetch(url);
	await assertOk(response);
	const data = (await response.json()) as { presets?: CommunityStylePreset[] };
	return Array.isArray(data.presets) ? data.presets : [];
}

/**
 * Downloads an import-compatible style preset payload.
 *
 * @param {string} id Community preset id.
 * @returns {Promise<VideoStyleFileData>} Style data ready for VideoStyle.importStyles.
 */
export async function getCommunityPresetStyle(id: string): Promise<VideoStyleFileData> {
	const response = await fetch(buildApiUrl(`/presets/${encodeURIComponent(id)}/style`));
	await assertOk(response);
	return (await response.json()) as VideoStyleFileData;
}

/**
 * Likes a community preset for one anonymous device.
 *
 * @param {string} id Community preset id.
 * @param {string} deviceId Stable anonymous device id.
 * @returns {Promise<{ likeCount: number; liked: boolean }>} Updated like state.
 */
export async function likeCommunityPreset(
	id: string,
	deviceId: string
): Promise<{ likeCount: number; liked: boolean }> {
	const response = await fetch(buildApiUrl(`/presets/${encodeURIComponent(id)}/like`), {
		method: 'POST',
		headers: {
			'X-QC-Device-Id': deviceId
		}
	});
	await assertOk(response);
	return (await response.json()) as { likeCount: number; liked: boolean };
}

/**
 * Loads popular community preset tags.
 *
 * @returns {Promise<CommunityPresetTag[]>} Popular tag list.
 */
export async function getPopularTags(): Promise<CommunityPresetTag[]> {
	const url = buildApiUrl('/tags/popular');
	url.searchParams.set('limit', '24');
	const response = await fetch(url);
	await assertOk(response);
	const data = (await response.json()) as { tags?: CommunityPresetTag[] };
	return Array.isArray(data.tags) ? data.tags : [];
}

/**
 * Publishes the current style preset to the community library.
 *
 * @param {PublishCommunityPresetParams} params Preset metadata, style JSON, and preview image.
 * @returns {Promise<CommunityStylePreset>} Created community preset metadata.
 */
export async function publishCommunityPreset(
	params: PublishCommunityPresetParams
): Promise<CommunityStylePreset> {
	const form = new FormData();
	form.append('name', params.name);
	form.append('authorName', params.authorName);
	form.append('description', params.description ?? '');
	form.append('tags', JSON.stringify(params.tags ?? []));
	form.append('resolution', JSON.stringify(params.resolution));
	form.append(
		'style',
		new Blob([JSON.stringify(params.style)], { type: 'application/json' }),
		'style.json'
	);
	form.append('preview', params.preview, 'preview.jpg');

	const response = await fetch(buildApiUrl('/presets'), {
		method: 'POST',
		body: form
	});
	await assertOk(response);
	return (await response.json()) as CommunityStylePreset;
}

/**
 * Returns a persistent anonymous device id for community interactions.
 *
 * @returns {Promise<string>} Stable anonymous device id.
 */
export async function getStyleLibraryDeviceId(): Promise<string> {
	const settings = globalState.settings ?? new Settings();
	if (!globalState.settings) globalState.settings = settings;

	if (!settings.persistentUiState.styleLibraryDeviceId) {
		settings.persistentUiState.styleLibraryDeviceId =
			globalThis.crypto?.randomUUID?.() ??
			`qc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		await Settings.save();
	}

	return settings.persistentUiState.styleLibraryDeviceId;
}
