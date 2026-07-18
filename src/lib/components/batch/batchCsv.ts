import { Batch, ProjectDetail, Utilities, type BatchSource } from '$lib/classes';
import { exists } from '@tauri-apps/plugin-fs';

export type BatchCsvErrorCode =
	| 'invalid-header'
	| 'missing-column'
	| 'too-many-columns'
	| 'malformed-csv'
	| 'project-name-empty'
	| 'reciter-empty'
	| 'source-empty'
	| 'project-name-too-long'
	| 'reciter-too-long'
	| 'project-name-unsafe'
	| 'reciter-unsafe'
	| 'invalid-url'
	| 'file-not-found'
	| 'unsupported-media';

export interface BatchCsvError {
	line: number;
	code: BatchCsvErrorCode;
}

export interface BatchCsvRow {
	line: number;
	projectName: string;
	reciter: string;
	source: string;
}

export interface ValidatedBatchRow extends BatchCsvRow {
	order: number;
	batchSource: BatchSource;
	errors: BatchCsvError[];
}

export interface BatchCsvParseResult {
	rows: BatchCsvRow[];
	errors: BatchCsvError[];
}

export interface BatchCsvValidationResult {
	rows: ValidatedBatchRow[];
	errors: BatchCsvError[];
}

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
	'mp4',
	'avi',
	'mov',
	'mkv',
	'flv',
	'webm',
	'mp3',
	'aac',
	'ogg',
	'flac',
	'm4a',
	'opus',
	'wav'
]);

/**
 * Parse le CSV de batch sans créer de projet.
 * @param {string} content Contenu UTF-8 du fichier CSV.
 * @returns {BatchCsvParseResult} Lignes parsées et erreurs structurelles.
 */
export function parseBatchCsv(content: string): BatchCsvParseResult {
	const input = content.replace(/^\uFEFF/, '');
	const records: { line: number; fields: string[] }[] = [];
	const errors: BatchCsvError[] = [];
	let fields: string[] = [];
	let field = '';
	let line = 1;
	let recordLine = 1;
	let inQuotes = false;

	for (let index = 0; index < input.length; index++) {
		const char = input[index];
		if (inQuotes) {
			if (char === '"') {
				if (input[index + 1] === '"') {
					field += '"';
					index++;
				} else {
					inQuotes = false;
				}
			} else {
				field += char;
				if (char === '\n') line++;
			}
			continue;
		}

		if (char === '"' && field.trim().length === 0) {
			field = '';
			inQuotes = true;
		} else if (char === ';') {
			fields.push(field.trim());
			field = '';
		} else if (char === '\n' || char === '\r') {
			fields.push(field.trim());
			records.push({ line: recordLine, fields });
			fields = [];
			field = '';
			if (char === '\r' && input[index + 1] === '\n') index++;
			line++;
			recordLine = line;
		} else {
			field += char;
		}
	}

	if (inQuotes) errors.push({ line: recordLine, code: 'malformed-csv' });
	if (field.length > 0 || fields.length > 0 || records.length === 0) {
		fields.push(field.trim());
		records.push({ line: recordLine, fields });
	}

	const nonEmptyRecords = records.filter((record) => record.fields.some((value) => value !== ''));
	const header = nonEmptyRecords.shift();
	const normalizedHeader = header ? [...header.fields] : [];
	while (normalizedHeader.length > 3 && normalizedHeader.at(-1) === '') normalizedHeader.pop();
	if (
		!header ||
		normalizedHeader.length !== 3 ||
		normalizedHeader[0] !== 'project_name' ||
		normalizedHeader[1] !== 'reciter' ||
		normalizedHeader[2] !== 'source'
	) {
		errors.push({ line: header?.line ?? 1, code: 'invalid-header' });
		return { rows: [], errors };
	}

	const rows: BatchCsvRow[] = [];
	for (const record of nonEmptyRecords) {
		const values = [...record.fields];
		while (values.length > 3 && values.at(-1) === '') values.pop();
		if (values.length < 3) {
			errors.push({ line: record.line, code: 'missing-column' });
			continue;
		}
		if (values.length > 3) {
			errors.push({ line: record.line, code: 'too-many-columns' });
			continue;
		}
		rows.push({
			line: record.line,
			projectName: values[0],
			reciter: values[1],
			source: values[2]
		});
	}

	return { rows, errors };
}

/**
 * Vérifie si une source locale possède une extension audio ou vidéo acceptée.
 * @param {string} filePath Chemin du média local.
 * @returns {boolean} True si l'extension est prise en charge.
 */
function isSupportedLocalMedia(filePath: string): boolean {
	const extension = filePath.split(/[\\/]/).at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
	return SUPPORTED_MEDIA_EXTENSIONS.has(extension);
}

/**
 * Valide toutes les lignes CSV avant la création du batch.
 * @param {BatchCsvRow[]} rows Lignes parsées dans l'ordre du CSV.
 * @param {(path: string) => Promise<boolean>} fileExists Vérificateur d'existence des fichiers.
 * @returns {Promise<BatchCsvValidationResult>} Lignes enrichies et erreurs bloquantes.
 */
export async function validateBatchRows(
	rows: BatchCsvRow[],
	fileExists: (path: string) => Promise<boolean> = exists
): Promise<BatchCsvValidationResult> {
	const validatedRows: ValidatedBatchRow[] = [];
	const allErrors: BatchCsvError[] = [];

	for (const [index, row] of rows.entries()) {
		const rowErrors: BatchCsvError[] = [];
		if (!row.projectName) rowErrors.push({ line: row.line, code: 'project-name-empty' });
		if (!row.reciter) rowErrors.push({ line: row.line, code: 'reciter-empty' });
		if (!row.source) rowErrors.push({ line: row.line, code: 'source-empty' });
		if (row.projectName.length > ProjectDetail.NAME_MAX_LENGTH) {
			rowErrors.push({ line: row.line, code: 'project-name-too-long' });
		}
		if (row.reciter.length > ProjectDetail.RECITER_MAX_LENGTH) {
			rowErrors.push({ line: row.line, code: 'reciter-too-long' });
		}
		if (row.projectName && Utilities.isPathNotSafe(row.projectName)) {
			rowErrors.push({ line: row.line, code: 'project-name-unsafe' });
		}
		if (row.reciter && Utilities.isPathNotSafe(row.reciter)) {
			rowErrors.push({ line: row.line, code: 'reciter-unsafe' });
		}

		const isUrl = /^https?:\/\//i.test(row.source);
		const batchSource: BatchSource = { kind: isUrl ? 'url' : 'file', value: row.source };
		if (row.source && isUrl) {
			try {
				const url = new URL(row.source);
				if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
			} catch {
				rowErrors.push({ line: row.line, code: 'invalid-url' });
			}
		} else if (row.source) {
			if (!(await fileExists(row.source))) {
				rowErrors.push({ line: row.line, code: 'file-not-found' });
			}
			if (!isSupportedLocalMedia(row.source)) {
				rowErrors.push({ line: row.line, code: 'unsupported-media' });
			}
		}

		allErrors.push(...rowErrors);
		validatedRows.push({ ...row, order: index + 1, batchSource, errors: rowErrors });
	}

	return { rows: validatedRows, errors: allErrors };
}

/**
 * Valide le nom modifiable du batch.
 * @param {string} name Nom saisi par l'utilisateur.
 * @returns {'empty' | 'too-long' | 'unsafe' | null} Erreur du nom ou null.
 */
export function validateBatchName(name: string): 'empty' | 'too-long' | 'unsafe' | null {
	const trimmedName = name.trim();
	if (!trimmedName) return 'empty';
	if (trimmedName.length > Batch.NAME_MAX_LENGTH) return 'too-long';
	if (Utilities.isPathNotSafe(trimmedName)) return 'unsafe';
	return null;
}
