import { env } from '$env/dynamic/public';

const DEFAULT_API_BASE_URL = 'https://api.qurancaption.com';

export type QuranReflectionRange = { from: number; to: number };
export type QuranReflectionSurah = {
	surah: number;
	firstAyah: number;
	lastAyah: number;
	ranges: QuranReflectionRange[];
	wholeSurah: boolean;
};
export type QuranReflectionContext = {
	surahs: QuranReflectionSurah[];
	multiSurah: boolean;
};
export type QuranReflectionPreview = {
	id: number;
	body: string;
	author: string;
	avatarUrl: string;
	url?: string;
	likesCount: number;
	language: string;
};
export type QuranReflectionNoteResult = { success: boolean; data: { id: string } };
export type QuranReflectionPublishResult = {
	success: boolean;
	data: { success: boolean; postId?: number };
};
export type ReflectionSubmissionMode = 'private' | 'public';
export type PendingQuranReflection = {
	context: QuranReflectionContext;
	surah: number;
	spanIndex: number;
	from: number;
	to: number;
	draft: string;
	action: ReflectionSubmissionMode | null;
	noteId: string | null;
	selectionMode?: 'whole' | 'range' | 'single';
};

/** Renvoie les scopes Notes enfants approuvés nécessaires à l'action demandée. */
export function getReflectionSubmissionScopes(mode: ReflectionSubmissionMode): string[] {
	return mode === 'public' ? ['note.create', 'note.publish'] : ['note.create'];
}

/** Vérifie les scopes Notes accordés pour une sauvegarde privée ou une publication. */
export function hasReflectionSubmissionScopes(
	grantedScopes: string[],
	mode: ReflectionSubmissionMode
): boolean {
	const hasScope = (scope: string) =>
		grantedScopes.includes(scope) || grantedScopes.includes(scope.split('.')[0]);
	return hasScope('note.create') && (mode === 'private' || hasScope('note.publish'));
}

/** Parse un brouillon persistant sans faire confiance au stockage local. */
export function parsePendingQuranReflection(value: string): PendingQuranReflection | null {
	try {
		const pending = JSON.parse(value) as PendingQuranReflection;
		if (
			!pending.context?.surahs?.length ||
			typeof pending.surah !== 'number' ||
			typeof pending.from !== 'number' ||
			typeof pending.to !== 'number' ||
			typeof pending.draft !== 'string' ||
			(pending.selectionMode !== undefined &&
				pending.selectionMode !== 'whole' &&
				pending.selectionMode !== 'range' &&
				pending.selectionMode !== 'single') ||
			(pending.action !== null && pending.action !== 'private' && pending.action !== 'public')
		) {
			return null;
		}
		return pending;
	} catch {
		return null;
	}
}

/** Détermine si une nouvelle opération d'export doit ouvrir l'expérience de réflexion. */
export function shouldPromptForReflection(
	previousState: string | undefined,
	currentState: string,
	exportKind: string,
	context: QuranReflectionContext | null | undefined
): boolean {
	return (
		exportKind === 'Video' &&
		previousState === undefined &&
		currentState !== 'Exported' &&
		currentState !== 'Error' &&
		currentState !== 'Canceled' &&
		Boolean(context)
	);
}

type QuranClipReference = {
	startTime: number;
	endTime: number;
	surah: number;
	verse: number;
};
type TimeRange = { startTime: number; endTime: number };

/**
 * Dérive les plages coraniques réellement présentes dans une opération d'export.
 * @param {QuranClipReference[]} clips Clips de sous-titres coraniques uniquement.
 * @param {number} exportStart Début de l'intervalle exporté en millisecondes.
 * @param {number} exportEnd Fin de l'intervalle exporté en millisecondes.
 * @param {Record<number, number>} verseCounts Nombre de versets par sourate.
 * @param {TimeRange[]} skipRanges Intervalles explicitement retirés de l'export.
 * @returns {QuranReflectionContext | null} Contexte sélectionnable ou null sans contenu coranique.
 */
export function deriveQuranReflectionContext(
	clips: QuranClipReference[],
	exportStart: number,
	exportEnd: number,
	verseCounts: Record<number, number>,
	skipRanges: TimeRange[] = []
): QuranReflectionContext | null {
	const versesBySurah = new Map<number, Set<number>>();
	const surahOrder: number[] = [];

	for (const clip of clips) {
		const includedStart = Math.max(exportStart, clip.startTime);
		const includedEnd = Math.min(exportEnd, clip.endTime);
		if (includedEnd <= includedStart) continue;

		let cursor = includedStart;
		for (const skip of [...skipRanges].sort((a, b) => a.startTime - b.startTime)) {
			if (skip.endTime <= cursor || skip.startTime >= includedEnd) continue;
			if (skip.startTime > cursor) break;
			cursor = Math.max(cursor, skip.endTime);
		}
		if (cursor >= includedEnd) continue;

		if (!versesBySurah.has(clip.surah)) {
			versesBySurah.set(clip.surah, new Set());
			surahOrder.push(clip.surah);
		}
		versesBySurah.get(clip.surah)!.add(clip.verse);
	}

	if (surahOrder.length === 0) return null;
	if (surahOrder.length > 1 && surahOrder.includes(1)) {
		surahOrder.splice(surahOrder.indexOf(1), 1);
		surahOrder.push(1);
	}

	const surahs = surahOrder.map((surah) => {
		const verses = [...versesBySurah.get(surah)!].sort((a, b) => a - b);
		const ranges: QuranReflectionRange[] = [];
		for (const verse of verses) {
			const current = ranges.at(-1);
			if (current && verse === current.to + 1) current.to = verse;
			else ranges.push({ from: verse, to: verse });
		}
		return {
			surah,
			firstAyah: verses[0],
			lastAyah: verses.at(-1)!,
			ranges,
			wholeSurah: ranges.length === 1 && ranges[0].from === 1 && ranges[0].to === verseCounts[surah]
		};
	});

	return { surahs, multiSurah: surahs.length > 1 };
}

/** Charge jusqu'à trois réflexions QDC reliées à une plage coranique. */
export async function getCuratedReflections(
	surah: number,
	from: number,
	to: number,
	language: string,
	signal?: AbortSignal
): Promise<QuranReflectionPreview[]> {
	const endpoint = new URL(
		'/quran-reflect/reflections',
		env.PUBLIC_STYLE_LIBRARY_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
	);
	endpoint.search = new URLSearchParams({
		chapterId: String(surah),
		from: String(from),
		to: String(to),
		language,
		limit: '3'
	}).toString();
	const response = await fetch(endpoint, { signal });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const payload = (await response.json()) as { reflections?: QuranReflectionPreview[] };
	return Array.isArray(payload.reflections) ? payload.reflections : [];
}

/** Crée une note Quran.com privée via le proxy Quran Caption. */
export async function createPrivateReflectionNote(
	accessToken: string,
	body: string,
	surah: number,
	from: number,
	to: number
): Promise<QuranReflectionNoteResult> {
	return postReflectionApi<QuranReflectionNoteResult>('/quran-reflect/notes', accessToken, {
		body,
		chapterId: surah,
		from,
		to
	});
}

/** Publie une note Quran.com existante vers QuranReflect. */
export async function publishReflectionNote(
	accessToken: string,
	noteId: string,
	body: string,
	surah: number,
	from: number,
	to: number,
	wholeSurah = false
): Promise<QuranReflectionPublishResult> {
	return postReflectionApi<QuranReflectionPublishResult>(
		`/quran-reflect/notes/${encodeURIComponent(noteId)}/publish`,
		accessToken,
		{ body, chapterId: surah, from, to, wholeSurah }
	);
}

/** Envoie un corps JSON authentifié au proxy QuranReflect. */
async function postReflectionApi<T>(
	path: string,
	accessToken: string,
	body: Record<string, unknown>
): Promise<T> {
	const endpoint = new URL(
		path,
		env.PUBLIC_STYLE_LIBRARY_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL
	);
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
		body: JSON.stringify(body)
	});
	const payload = (await response.json().catch(() => null)) as
		| { error?: string; message?: string }
		| T
		| null;
	if (!response.ok) {
		const error =
			payload && typeof payload === 'object' && ('error' in payload || 'message' in payload)
				? payload.error || payload.message
				: null;
		throw new Error(error || `HTTP ${response.status}`);
	}
	if (!payload) throw new Error('EMPTY_RESPONSE');
	return payload as T;
}
