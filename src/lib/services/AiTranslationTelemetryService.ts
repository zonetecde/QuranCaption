import type { Edition } from '$lib/classes';
import type { TranslationStatus } from '$lib/classes/Translation.svelte';
import Settings from '$lib/classes/Settings.svelte';
import type { AdvancedTrimBatch } from '$lib/services/AdvancedAITrimming';
import { globalState } from '$lib/runes/main.svelte';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { AnalyticsService } from './AnalyticsService';

export type AiTranslationTelemetryStatus =
	| 'ai trimmed'
	| 'ai error'
	| 'reviewed'
	| 'automatically trimmed'
	| 'fetched';
export type AiTranslationTelemetrySourceMode = 'legacy' | 'advanced' | 'manual';
export type AiTranslationTelemetryConsent = 'unknown' | 'granted' | 'denied';

export type AiTranslationSourceWord = {
	i: number;
	w: string;
};

export type AiTranslationTelemetryItem = {
	id: string;
	projectId: number;
	editionKey: string;
	editionName: string;
	verseKey: string;
	subtitleId: number;
	sourceMode: AiTranslationTelemetrySourceMode;
	status: AiTranslationTelemetryStatus;
	segment: string;
	aiTranslation?: string;
	manualReview?: string;
	createdAt: string;
	updatedAt: string;
	uploadedAt?: string;
};

export type AiTranslationTelemetryExportClip = {
	subtitleId: number;
	startTime: number;
	endTime: number;
};

export type AiTranslationTelemetryExportScope = {
	id: string;
	projectId: number;
	exportStartMs: number;
	exportEndMs: number;
	submittedAt: string;
	itemIds: string[];
};

export type AiTelemetryFile = {
	version: 2;
	items: AiTranslationTelemetryItem[];
	submittedExportScopes: AiTranslationTelemetryExportScope[];
};

type LegacyTelemetryDiskItem = Partial<AiTranslationTelemetryItem> & {
	aiStatus?: 'ai trimmed' | 'ai error';
};

type LegacyTelemetryEntry = {
	verseKey: string;
	subtitleId: number;
	segment: string;
	translationWords: AiTranslationSourceWord[];
	aiRange: [number, number] | null;
	status: Extract<AiTranslationTelemetryStatus, 'ai trimmed' | 'ai error'>;
};

type AdvancedTelemetryParams = {
	projectId: number;
	edition: Pick<Edition, 'key' | 'name'>;
	batch: AdvancedTrimBatch;
	parsedResponse: unknown;
};

type LegacyTelemetryParams = {
	projectId: number;
	edition: Pick<Edition, 'key' | 'name'>;
	entries: LegacyTelemetryEntry[];
};

const TELEMETRY_FILE_NAME = 'telemetry.json';

function createEmptyTelemetryFile(): AiTelemetryFile {
	return {
		version: 2,
		items: [],
		submittedExportScopes: []
	};
}

function normalizeText(value: string | undefined | null): string {
	return String(value ?? '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.trim();
}

function createStableItemId(
	item: Pick<AiTranslationTelemetryItem, 'projectId' | 'editionKey' | 'subtitleId' | 'sourceMode'>
): string {
	return `${item.projectId}:${item.editionKey}:${item.subtitleId}:${item.sourceMode}`;
}

export function normalizeTelemetryExportBounds(
	exportStartMs: number,
	exportEndMs: number
): { exportStartMs: number; exportEndMs: number } {
	const start = Math.max(0, Math.round(exportStartMs || 0));
	const roundedEnd = Math.max(0, Math.round(exportEndMs || 0));
	const end = roundedEnd > start ? roundedEnd : start + 1;

	return {
		exportStartMs: start,
		exportEndMs: end
	};
}

export function createStableExportScopeId(scope: {
	projectId: number;
	exportStartMs: number;
	exportEndMs: number;
}): string {
	const normalized = normalizeTelemetryExportBounds(scope.exportStartMs, scope.exportEndMs);
	return `${scope.projectId}:${normalized.exportStartMs}:${normalized.exportEndMs}`;
}

function rangesOverlap(
	rangeStartMs: number,
	rangeEndMs: number,
	clipStartMs: number,
	clipEndMs: number
): boolean {
	return clipEndMs > rangeStartMs && clipStartMs < rangeEndMs;
}

export function filterTelemetryItemsForExportScope(
	items: AiTranslationTelemetryItem[],
	scope: {
		projectId: number;
		exportStartMs: number;
		exportEndMs: number;
		clips: AiTranslationTelemetryExportClip[];
	}
): AiTranslationTelemetryItem[] {
	const normalized = normalizeTelemetryExportBounds(scope.exportStartMs, scope.exportEndMs);
	const allowedSubtitleIds = new Set(
		scope.clips
			.filter((clip) =>
				rangesOverlap(
					normalized.exportStartMs,
					normalized.exportEndMs,
					clip.startTime,
					clip.endTime
				)
			)
			.map((clip) => clip.subtitleId)
	);

	return items
		.filter((item) => item.projectId === scope.projectId && allowedSubtitleIds.has(item.subtitleId))
		.sort((left, right) => {
			if (left.subtitleId !== right.subtitleId) return left.subtitleId - right.subtitleId;
			if (left.editionKey !== right.editionKey)
				return left.editionKey.localeCompare(right.editionKey);
			return left.sourceMode.localeCompare(right.sourceMode);
		});
}

function sanitizeSubmittedExportScope(rawScope: unknown): AiTranslationTelemetryExportScope | null {
	if (!rawScope || typeof rawScope !== 'object') return null;

	const projectId = Number((rawScope as { projectId?: unknown }).projectId);
	const exportStartMs = Number((rawScope as { exportStartMs?: unknown }).exportStartMs);
	const exportEndMs = Number((rawScope as { exportEndMs?: unknown }).exportEndMs);
	const submittedAt =
		normalizeText((rawScope as { submittedAt?: unknown }).submittedAt as string) ||
		new Date().toISOString();
	const itemIds = Array.isArray((rawScope as { itemIds?: unknown[] }).itemIds)
		? (rawScope as { itemIds: unknown[] }).itemIds
				.map((itemId) => normalizeText(typeof itemId === 'string' ? itemId : ''))
				.filter(Boolean)
		: [];

	if (!Number.isInteger(projectId)) return null;

	const normalized = normalizeTelemetryExportBounds(exportStartMs, exportEndMs);

	return {
		id:
			normalizeText((rawScope as { id?: unknown }).id as string) ||
			createStableExportScopeId({
				projectId,
				exportStartMs: normalized.exportStartMs,
				exportEndMs: normalized.exportEndMs
			}),
		projectId,
		exportStartMs: normalized.exportStartMs,
		exportEndMs: normalized.exportEndMs,
		submittedAt,
		itemIds
	};
}

function toTelemetryStatus(
	value: unknown,
	fallback?: unknown
): AiTranslationTelemetryStatus | null {
	if (
		value === 'ai trimmed' ||
		value === 'ai error' ||
		value === 'reviewed' ||
		value === 'automatically trimmed' ||
		value === 'fetched'
	) {
		return value;
	}

	if (fallback === 'ai trimmed' || fallback === 'ai error') {
		return fallback;
	}

	return null;
}

function toTelemetrySourceMode(value: unknown): AiTranslationTelemetrySourceMode {
	if (value === 'legacy' || value === 'advanced' || value === 'manual') {
		return value;
	}

	return 'legacy';
}

function sanitizeTelemetryItem(
	rawItem: LegacyTelemetryDiskItem
): AiTranslationTelemetryItem | null {
	const projectId = Number(rawItem.projectId);
	const subtitleId = Number(rawItem.subtitleId);
	const editionKey = normalizeText(rawItem.editionKey);
	const editionName = normalizeText(rawItem.editionName);
	const verseKey = normalizeText(rawItem.verseKey);
	const segment = normalizeText(rawItem.segment);
	const status = toTelemetryStatus(rawItem.status, rawItem.aiStatus);

	if (
		!Number.isInteger(projectId) ||
		!Number.isInteger(subtitleId) ||
		!editionKey ||
		!editionName ||
		!verseKey ||
		!segment ||
		!status
	) {
		return null;
	}

	const sourceMode = toTelemetrySourceMode(rawItem.sourceMode);
	const createdAt = normalizeText(rawItem.createdAt) || new Date().toISOString();
	const updatedAt = normalizeText(rawItem.updatedAt) || createdAt;
	const aiTranslation = normalizeText(rawItem.aiTranslation);
	const manualReview = normalizeText(rawItem.manualReview);
	const uploadedAt = normalizeText(rawItem.uploadedAt);

	return {
		id:
			normalizeText(rawItem.id) ||
			createStableItemId({
				projectId,
				editionKey,
				subtitleId,
				sourceMode
			}),
		projectId,
		editionKey,
		editionName,
		verseKey,
		subtitleId,
		sourceMode,
		status,
		segment,
		aiTranslation: aiTranslation || undefined,
		manualReview: manualReview || undefined,
		createdAt,
		updatedAt,
		uploadedAt: uploadedAt || undefined
	};
}

export function reconstructTranslationFromRange(
	translationWords: AiTranslationSourceWord[],
	aiRange: [number, number] | null
): string {
	if (!Array.isArray(aiRange) || aiRange.length !== 2) return '';

	const [start, end] = aiRange;
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return '';

	return translationWords
		.slice()
		.sort((left, right) => left.i - right.i)
		.filter((word) => word.i >= start && word.i <= end)
		.map((word) => word.w)
		.join(' ')
		.trim();
}

export function upsertTelemetryItem(
	items: AiTranslationTelemetryItem[],
	nextItem: AiTranslationTelemetryItem
): AiTranslationTelemetryItem[] {
	const stableId = createStableItemId(nextItem);
	const existingIndex = items.findIndex((item) => item.id === stableId);

	if (existingIndex === -1) {
		return [...items, { ...nextItem, id: stableId }];
	}

	const existing = items[existingIndex];
	const updated: AiTranslationTelemetryItem = {
		...existing,
		...nextItem,
		id: stableId,
		createdAt: existing.createdAt,
		updatedAt: nextItem.updatedAt,
		manualReview: undefined,
		uploadedAt: undefined
	};

	const clone = [...items];
	clone[existingIndex] = updated;
	return clone;
}

export function applyManualReviewToTelemetryItem(
	item: AiTranslationTelemetryItem,
	manualReview: string,
	updatedAt: string
): AiTranslationTelemetryItem {
	const normalizedReview = normalizeText(manualReview);
	const normalizedAiTranslation = normalizeText(item.aiTranslation);
	const nextManualReview =
		normalizedReview.length > 0 && normalizedReview !== normalizedAiTranslation
			? normalizedReview
			: undefined;

	return {
		...item,
		manualReview: nextManualReview,
		updatedAt,
		uploadedAt: undefined
	};
}

export function extractAdvancedAiTranslations(
	parsedResponse: unknown
): Map<string, Map<number, string>> {
	const result = new Map<string, Map<number, string>>();
	if (!parsedResponse || typeof parsedResponse !== 'object') return result;

	const verses = (parsedResponse as { verses?: unknown }).verses;
	if (!Array.isArray(verses)) return result;

	for (const verse of verses) {
		if (!verse || typeof verse !== 'object') continue;
		const verseKey = (verse as { verseKey?: unknown }).verseKey;
		const segments = (verse as { segments?: unknown }).segments;
		if (typeof verseKey !== 'string' || !Array.isArray(segments)) continue;

		const textByIndex = new Map<number, string>();
		for (const segment of segments) {
			if (!segment || typeof segment !== 'object') continue;
			const index = Number((segment as { i?: unknown }).i);
			const text = (segment as { text?: unknown }).text;
			if (!Number.isInteger(index) || typeof text !== 'string') continue;
			textByIndex.set(index, text);
		}

		result.set(verseKey, textByIndex);
	}

	return result;
}

export default class AiTranslationTelemetryService {
	private static cache: AiTelemetryFile | null = null;
	private static mutationQueue: Promise<void> = Promise.resolve();
	private static pendingExportScope: {
		projectId: number;
		exportStartMs: number;
		exportEndMs: number;
		clips: AiTranslationTelemetryExportClip[];
	} | null = null;

	private static async getTelemetryFilePath(): Promise<string> {
		return join(await appDataDir(), TELEMETRY_FILE_NAME);
	}

	private static async readFileFromDisk(): Promise<AiTelemetryFile> {
		const filePath = await this.getTelemetryFilePath();
		if (!(await exists(filePath))) {
			return createEmptyTelemetryFile();
		}

		try {
			const rawContent = await readTextFile(filePath);
			const parsed = JSON.parse(rawContent) as Partial<AiTelemetryFile>;
			return {
				version: 2,
				items: Array.isArray(parsed.items)
					? parsed.items
							.map((item) => sanitizeTelemetryItem(item as LegacyTelemetryDiskItem))
							.filter((item): item is AiTranslationTelemetryItem => item !== null)
					: [],
				submittedExportScopes: Array.isArray(parsed.submittedExportScopes)
					? parsed.submittedExportScopes
							.map((scope) => sanitizeSubmittedExportScope(scope))
							.filter((scope): scope is AiTranslationTelemetryExportScope => scope !== null)
					: []
			};
		} catch (error) {
			console.warn('Failed to read AI translation telemetry file:', error);
			return createEmptyTelemetryFile();
		}
	}

	private static async mutateFile<T>(
		mutator: (file: AiTelemetryFile) => Promise<T> | T
	): Promise<T> {
		let result!: T;
		const task = this.mutationQueue
			.catch(() => undefined)
			.then(async () => {
				const file = await this.loadFile();
				result = await mutator(file);
				await this.saveFile(file);
			});

		this.mutationQueue = task.then(
			() => undefined,
			() => undefined
		);

		await task;
		return result;
	}

	private static syncPromptUi(visible: boolean, pendingCount: number = 0): void {
		globalState.uiState.showAiTranslationTelemetryPrompt = visible;
		globalState.uiState.aiTranslationTelemetryPendingCount = pendingCount;
	}

	static async loadFile(): Promise<AiTelemetryFile> {
		if (this.cache) return this.cache;
		this.cache = await this.readFileFromDisk();
		return this.cache;
	}

	static async saveFile(file: AiTelemetryFile): Promise<void> {
		this.cache = file;
		const filePath = await this.getTelemetryFilePath();
		await writeTextFile(filePath, JSON.stringify(file, null, 2));
	}

	private static async getExportItemsFromScope(scope: {
		projectId: number;
		exportStartMs: number;
		exportEndMs: number;
		clips: AiTranslationTelemetryExportClip[];
	}): Promise<AiTranslationTelemetryItem[]> {
		const file = await this.loadFile();
		return filterTelemetryItemsForExportScope(file.items, scope);
	}

	private static async hasSubmittedExportScope(scope: {
		projectId: number;
		exportStartMs: number;
		exportEndMs: number;
	}): Promise<boolean> {
		const file = await this.loadFile();
		const scopeId = createStableExportScopeId(scope);
		return file.submittedExportScopes.some((submittedScope) => submittedScope.id === scopeId);
	}

	static async getPendingItems(): Promise<AiTranslationTelemetryItem[]> {
		const file = await this.loadFile();
		return file.items.filter((item) => !item.uploadedAt);
	}

	static async hasPendingItems(): Promise<boolean> {
		return (await this.getPendingItems()).length > 0;
	}

	static async recordLegacyRun(params: LegacyTelemetryParams): Promise<void> {
		await this.mutateFile(async (file) => {
			for (const entry of params.entries) {
				const now = new Date().toISOString();
				file.items = upsertTelemetryItem(file.items, {
					id: '',
					projectId: params.projectId,
					editionKey: params.edition.key,
					editionName: params.edition.name,
					verseKey: entry.verseKey,
					subtitleId: entry.subtitleId,
					sourceMode: 'legacy',
					status: entry.status,
					segment: entry.segment,
					aiTranslation: reconstructTranslationFromRange(entry.translationWords, entry.aiRange),
					createdAt: now,
					updatedAt: now
				});
			}
		});
	}

	static async recordAdvancedRun(params: AdvancedTelemetryParams): Promise<void> {
		const parsedTextByVerse = extractAdvancedAiTranslations(params.parsedResponse);

		await this.mutateFile(async (file) => {
			for (const verse of params.batch.verses) {
				const parsedTextByIndex =
					parsedTextByVerse.get(verse.verseKey) ?? new Map<number, string>();

				for (const segment of verse.segments) {
					if (!segment.needsAi) continue;

					const subtitle = verse.subtitles[segment.i];
					if (!subtitle) continue;

					const translation = subtitle.translations[params.edition.name] as {
						status?: unknown;
					} | null;
					const nextStatus: AiTranslationTelemetryStatus =
						translation?.status === 'ai trimmed' ? 'ai trimmed' : 'ai error';
					const now = new Date().toISOString();

					file.items = upsertTelemetryItem(file.items, {
						id: '',
						projectId: params.projectId,
						editionKey: params.edition.key,
						editionName: params.edition.name,
						verseKey: verse.verseKey,
						subtitleId: subtitle.id,
						sourceMode: 'advanced',
						status: nextStatus,
						segment: segment.arabic,
						aiTranslation: normalizeText(parsedTextByIndex.get(segment.i) ?? ''),
						createdAt: now,
						updatedAt: now
					});
				}
			}
		});
	}

	static async recordManualReview(params: {
		projectId: number;
		editionKey: string;
		editionName: string;
		subtitleId: number;
		verseKey: string;
		segment: string;
		status: TranslationStatus;
		manualReview: string;
	}): Promise<void> {
		await this.mutateFile(async (file) => {
			const normalizedReview = normalizeText(params.manualReview);
			const matchingIndexes = file.items
				.map((item, index) => ({ item, index }))
				.filter(
					({ item }) =>
						item.projectId === params.projectId &&
						item.editionKey === params.editionKey &&
						item.subtitleId === params.subtitleId
				)
				.sort(
					(left, right) =>
						new Date(right.item.updatedAt).getTime() - new Date(left.item.updatedAt).getTime()
				);

			const now = new Date().toISOString();
			const preferredTarget =
				matchingIndexes.find(({ item }) => item.sourceMode !== 'manual') ?? matchingIndexes[0];

			if (preferredTarget) {
				file.items[preferredTarget.index] = applyManualReviewToTelemetryItem(
					preferredTarget.item,
					normalizedReview,
					now
				);
				return;
			}

			if (
				(params.status !== 'reviewed' &&
					params.status !== 'automatically trimmed' &&
					params.status !== 'fetched') ||
				!normalizedReview
			) {
				return;
			}

			file.items = upsertTelemetryItem(file.items, {
				id: '',
				projectId: params.projectId,
				editionKey: params.editionKey,
				editionName: params.editionName,
				verseKey: params.verseKey,
				subtitleId: params.subtitleId,
				sourceMode: 'manual',
				status: params.status,
				segment: params.segment,
				manualReview: normalizedReview,
				createdAt: now,
				updatedAt: now
			});
		});
	}

	static async setTelemetryConsent(consent: AiTranslationTelemetryConsent): Promise<void> {
		if (!globalState.settings) return;
		globalState.settings.aiTranslationSettings.telemetryConsent = consent;
		this.syncPromptUi(false, globalState.uiState.aiTranslationTelemetryPendingCount);
		await Settings.save();
	}

	static async handleVideoExportRequested(params: {
		projectId: number;
		exportStartMs: number;
		exportEndMs: number;
		clips: AiTranslationTelemetryExportClip[];
	}): Promise<void> {
		const normalized = normalizeTelemetryExportBounds(params.exportStartMs, params.exportEndMs);
		const scope = {
			projectId: params.projectId,
			exportStartMs: normalized.exportStartMs,
			exportEndMs: normalized.exportEndMs,
			clips: params.clips
		};

		this.pendingExportScope = scope;

		if (await this.hasSubmittedExportScope(scope)) {
			this.pendingExportScope = null;
			this.syncPromptUi(false, 0);
			return;
		}

		const pendingItems = await this.getExportItemsFromScope(scope);
		const pendingCount = pendingItems.length;
		const consent = globalState.settings?.aiTranslationSettings.telemetryConsent ?? 'unknown';

		if (pendingCount === 0) {
			this.pendingExportScope = null;
			this.syncPromptUi(false, 0);
			return;
		}

		if (consent === 'granted') {
			this.syncPromptUi(false, pendingCount);
			void this.submitPendingToPostHog();
			return;
		}

		if (consent === 'denied') {
			this.syncPromptUi(false, pendingCount);
			return;
		}

		this.syncPromptUi(true, pendingCount);
	}

	static async submitPendingToPostHog(): Promise<boolean> {
		const scope = this.pendingExportScope;
		if (!scope) {
			this.syncPromptUi(false, 0);
			return true;
		}

		if (await this.hasSubmittedExportScope(scope)) {
			this.pendingExportScope = null;
			this.syncPromptUi(false, 0);
			return true;
		}

		const pendingItems = await this.getExportItemsFromScope(scope);
		if (pendingItems.length === 0) {
			this.pendingExportScope = null;
			this.syncPromptUi(false, 0);
			return true;
		}

		globalState.uiState.aiTranslationTelemetrySubmitting = true;

		try {
			AnalyticsService.track('ai_translation_telemetry_submitted', {
				project_id: scope.projectId,
				export_start_ms: scope.exportStartMs,
				export_end_ms: scope.exportEndMs,
				export_scope_id: createStableExportScopeId(scope),
				item_count: pendingItems.length,
				contains_manual_reviews: pendingItems.some((item) => !!item.manualReview),
				app_version: globalState.settings?.appVersion ?? '0.0.0',
				items: pendingItems.map((item) => ({
					status: item.status,
					segment: item.segment,
					aiTranslation: item.aiTranslation,
					manualReview: item.manualReview,
					sourceMode: item.sourceMode,
					editionKey: item.editionKey,
					verseKey: item.verseKey
				}))
			});

			const uploadedAt = new Date().toISOString();
			await this.mutateFile(async (file) => {
				file.items = file.items.map((item) =>
					pendingItems.some((pending) => pending.id === item.id)
						? { ...item, uploadedAt, updatedAt: uploadedAt }
						: item
				);

				const scopeId = createStableExportScopeId(scope);
				if (!file.submittedExportScopes.some((submittedScope) => submittedScope.id === scopeId)) {
					file.submittedExportScopes.push({
						id: scopeId,
						projectId: scope.projectId,
						exportStartMs: scope.exportStartMs,
						exportEndMs: scope.exportEndMs,
						submittedAt: uploadedAt,
						itemIds: pendingItems.map((item) => item.id)
					});
				}
			});

			this.syncPromptUi(false, 0);
			this.pendingExportScope = null;
			return true;
		} catch (error) {
			console.warn('Failed to submit AI translation telemetry to PostHog:', error);
			this.syncPromptUi(false, pendingItems.length);
			return false;
		} finally {
			globalState.uiState.aiTranslationTelemetrySubmitting = false;
		}
	}
}
