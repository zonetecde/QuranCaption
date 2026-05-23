import type {
	ImportedSegmentationParseResult,
	SegmentationResponse,
	SegmentationSegment,
	SegmentationWordTimestamp
} from './types';

/**
 * Convertit une valeur inconnue en chaîne non vide.
 *
 * @param {unknown} value Valeur à convertir.
 * @returns {string | undefined} Chaîne nettoyée, sinon undefined.
 */
export function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Convertit une valeur inconnue en nombre fini.
 *
 * @param {unknown} value Valeur à convertir.
 * @returns {number | undefined} Nombre fini, sinon undefined.
 */
export function asFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

/**
 * Convertit une valeur inconnue en booléen.
 *
 * @param {unknown} value Valeur à convertir.
 * @returns {boolean | undefined} Booléen, sinon undefined.
 */
export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

/**
 * Normalise une liste brute de timestamps de mots (format API).
 *
 * @param {unknown} value Valeur brute potentiellement un tableau.
 * @returns {Array<{ key: string; start: number; end: number; type: string }>} Liste normalisée.
 */
export function normalizeWordTimestamps(
	value: unknown
): Array<{ key: string; start: number; end: number; type: string }> {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const key = asNonEmptyString((entry as { key?: unknown }).key);
			const start = asFiniteNumber((entry as { start?: unknown }).start);
			const end = asFiniteNumber((entry as { end?: unknown }).end);
			const type = asNonEmptyString((entry as { type?: unknown }).type);
			if (!key || start === undefined || end === undefined || !type) return null;
			return { key, start, end, type };
		})
		.filter((entry): entry is { key: string; start: number; end: number; type: string } => !!entry);
}

/**
 * Normalise une liste brute de mots MFA.
 *
 * @param {unknown} value Valeur brute (tableau de tableaux ou d'objets).
 * @returns {SegmentationWordTimestamp[]} Liste normalisée.
 */
export function normalizeSegmentWords(value: unknown): SegmentationWordTimestamp[] {
	if (!Array.isArray(value)) return [];

	return value
		.map((entry) => {
			if (Array.isArray(entry)) {
				const location = asNonEmptyString(entry[0]);
				const start = asFiniteNumber(entry[1]);
				const end = asFiniteNumber(entry[2]);
				if (!location || start === undefined || end === undefined) return null;
				return { location, start, end };
			}

			if (!entry || typeof entry !== 'object') return null;
			const location =
				asNonEmptyString((entry as { location?: unknown }).location) ??
				asNonEmptyString((entry as { key?: unknown }).key);
			const start = asFiniteNumber((entry as { start?: unknown }).start);
			const end = asFiniteNumber((entry as { end?: unknown }).end);
			const word = asNonEmptyString((entry as { word?: unknown }).word);
			if (!location || start === undefined || end === undefined) return null;
			return word ? { location, start, end, word } : { location, start, end };
		})
		.filter((entry): entry is SegmentationWordTimestamp => !!entry);
}

/**
 * Normalise une réponse MFA partielle en réinjectant les métadonnées manquantes
 * depuis les segments source.
 *
 * @param {unknown} value Segments MFA bruts renvoyés par l'API.
 * @param {SegmentationSegment[]} fallbackSegments Segments source déjà connus côté app.
 * @returns {SegmentationSegment[]} Segments MFA exploitables par le reste du pipeline.
 */
export function normalizeMfaSegments(
	value: unknown,
	fallbackSegments: SegmentationSegment[]
): SegmentationSegment[] {
	if (!Array.isArray(value)) return [];

	const normalizedSegments: SegmentationSegment[] = [];

	for (const [index, entry] of value.entries()) {
		if (!entry || typeof entry !== 'object') continue;

		const segment = entry as Record<string, unknown>;
		const fallbackSegment = fallbackSegments[index];
		const normalizedError =
			segment.error === null
				? null
				: (asNonEmptyString(segment.error) ?? fallbackSegment?.error ?? null);

		normalizedSegments.push({
			segment: asFiniteNumber(segment.segment) ?? fallbackSegment?.segment ?? index,
			time_from: asFiniteNumber(segment.time_from) ?? fallbackSegment?.time_from,
			time_to: asFiniteNumber(segment.time_to) ?? fallbackSegment?.time_to,
			ref_from: asNonEmptyString(segment.ref_from) ?? fallbackSegment?.ref_from ?? '',
			ref_to: asNonEmptyString(segment.ref_to) ?? fallbackSegment?.ref_to ?? '',
			matched_text: asNonEmptyString(segment.matched_text) ?? fallbackSegment?.matched_text ?? '',
			confidence: asFiniteNumber(segment.confidence) ?? fallbackSegment?.confidence,
			has_missing_words: asBoolean(segment.has_missing_words) ?? fallbackSegment?.has_missing_words,
			potentially_undersegmented:
				asBoolean(segment.potentially_undersegmented) ??
				fallbackSegment?.potentially_undersegmented,
			special_type: asNonEmptyString(segment.special_type) ?? fallbackSegment?.special_type,
			error: normalizedError,
			words: normalizeSegmentWords(segment.words),
			word_timestamps: normalizeWordTimestamps(segment.word_timestamps)
		});
	}

	return normalizedSegments;
}

/**
 * Normalise un segment importé (JSON ou objet).
 *
 * @param {unknown} raw Segment brut.
 * @param {number} index Index du segment dans le tableau.
 * @returns {SegmentationSegment} Segment normalisé.
 * @throws {Error} Si le segment est invalide.
 */
export function normalizeImportedSegment(raw: unknown, index: number): SegmentationSegment {
	if (!raw || typeof raw !== 'object') {
		throw new Error(`Invalid segment at index ${index}: expected an object.`);
	}

	const segment = raw as Record<string, unknown>;
	const timeFrom = asFiniteNumber(segment.time_from);
	const timeTo = asFiniteNumber(segment.time_to);
	if (timeFrom === undefined || timeTo === undefined) {
		throw new Error(`Invalid segment at index ${index}: 'time_from' and 'time_to' are required.`);
	}

	const normalizedError =
		segment.error === null ? null : (asNonEmptyString(segment.error) ?? undefined);

	return {
		segment: asFiniteNumber(segment.segment),
		time_from: Math.max(0, timeFrom),
		time_to: Math.max(Math.max(0, timeFrom), timeTo),
		ref_from: asNonEmptyString(segment.ref_from) ?? '',
		ref_to: asNonEmptyString(segment.ref_to) ?? '',
		matched_text: asNonEmptyString(segment.matched_text) ?? '',
		confidence: asFiniteNumber(segment.confidence),
		has_missing_words: asBoolean(segment.has_missing_words),
		potentially_undersegmented: asBoolean(segment.potentially_undersegmented),
		special_type: asNonEmptyString(segment.special_type),
		error: normalizedError ?? null,
		words: normalizeSegmentWords(segment.words),
		word_timestamps: normalizeWordTimestamps(segment.word_timestamps)
	};
}

/**
 * Parse une charge JSON de segmentation importée (chaîne ou objet).
 *
 * @param {string | unknown} input Charge JSON brute.
 * @returns {ImportedSegmentationParseResult} Résultat parsé et normalisé.
 * @throws {Error} Si le format est invalide.
 */
export function parseImportedSegmentationJson(
	input: string | unknown
): ImportedSegmentationParseResult {
	let parsed: unknown = input;
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (!trimmed) throw new Error('JSON input is empty.');
		try {
			parsed = JSON.parse(trimmed);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid JSON format: ${message}`);
		}
	}

	if (!parsed || typeof parsed !== 'object') {
		throw new Error("Invalid payload: expected a JSON object with a 'segments' array.");
	}

	const root = parsed as Record<string, unknown>;
	const rawSegments = root.segments;
	if (!Array.isArray(rawSegments)) {
		throw new Error("Invalid payload: missing 'segments' array.");
	}

	const normalizedSegments = rawSegments.map((segment, index) =>
		normalizeImportedSegment(segment, index)
	);
	if (normalizedSegments.length === 0) {
		throw new Error("Invalid payload: 'segments' array is empty.");
	}

	const response: SegmentationResponse = {
		audio_id: asNonEmptyString(root.audio_id),
		error: asNonEmptyString(root.error),
		warning: asNonEmptyString(root.warning),
		segments: normalizedSegments
	};

	return { response, segmentCount: normalizedSegments.length };
}

/**
 * Tente d'extraire une réponse de segmentation JSON depuis un message d'erreur.
 *
 * @param {unknown} error Erreur potentiellement levée par le backend local.
 * @returns {SegmentationResponse | null} Réponse normalisée si trouvée, sinon null.
 */
export function parseSegmentationResponseFromThrownError(
	error: unknown
): SegmentationResponse | null {
	const message = error instanceof Error ? error.message : String(error);
	const jsonStartIndex = message.indexOf('{');
	if (jsonStartIndex < 0) return null;

	const jsonPayload = message.slice(jsonStartIndex).trim();
	try {
		return parseImportedSegmentationJson(jsonPayload).response;
	} catch {
		return null;
	}
}
