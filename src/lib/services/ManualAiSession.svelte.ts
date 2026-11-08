import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import type editor from '$lib/i18n/en/editor';
import LL from '$lib/i18n/i18n-svelte';

export type ManualAiCopy = {
	[K in keyof typeof editor.manualAi]: () => string;
};
export type ManualAiStep = {
	prompt: string;
	response: string;
	error: string;
	status: 'waiting' | 'valid';
};

/**
 * Résout les libellés du parcours manuel dans la langue active.
 * @returns {ManualAiCopy} Textes localisés.
 */
function getManualAiCopy(): ManualAiCopy {
	return (get(LL).editor as unknown as { manualAi: ManualAiCopy }).manualAi;
}

/**
 * Décode la réponse en ne corrigeant les erreurs de formatage qu'en cas d'échec.
 * @param {string} json Objet JSON extrait de la réponse.
 * @returns {{ requestId?: unknown; result?: unknown }} Enveloppe décodée.
 */
function parseManualAiJson(json: string): { requestId?: unknown; result?: unknown } {
	try {
		return JSON.parse(json);
	} catch {
		const formatted = json.replace(/\\[ \t]*\r?\n/g, '\n').replace(/^([ \t]*)&#x20;/gim, '$1 ');
		try {
			return JSON.parse(formatted);
		} catch {
			// Le premier essai préserve les guillemets et antislashs déjà valides.
			const escaped = formatted.replace(/(?<!\\)\\\\"/g, '\\"');
			try {
				return JSON.parse(escaped);
			} catch {
				return JSON.parse(
					escaped.replace(
						/("text"\s*:\s*")((?:\\.|(?!"\s*:)[^\\}\r\n])*?)"(?=\s*})/g,
						/**
						 * Échappe les guillemets du texte sans absorber d'accolade ou de clé JSON.
						 * @param {string} _match Champ text complet.
						 * @param {string} prefix Clé et guillemet ouvrant.
						 * @param {string} text Contenu avec ses échappements existants.
						 * @returns {string} Champ text aux guillemets échappés.
						 */
						(_match: string, prefix: string, text: string) =>
							`${prefix}${text.replace(/\\([\s\S])|(")/g, '\\$1$2')}"`
					)
				);
			}
		}
	}
}

/** Maintient les réponses manuelles en mémoire jusqu'à leur validation ou l'annulation. */
export class ManualAiSession {
	steps = $state<ManualAiStep[]>([]);
	active = $state(false);
	ready = $state(false);
	totalSteps = $state(0);
	private pending: { accept: () => void; reject: (error: Error) => void } | null = null;

	/** Retourne la progression des réponses attendues. @returns {number} Pourcentage validé. */
	get progress(): number {
		let valid = 0;
		for (const step of this.steps) if (step.status === 'valid') valid++;
		return this.totalSteps ? Math.round((valid / this.totalSteps) * 100) : 0;
	}

	/** Réinitialise les réponses avant une nouvelle préparation. @returns {void} */
	start(): void {
		this.cancel();
		this.steps = [];
		this.totalSteps = 0;
		this.ready = false;
		this.active = true;
	}

	/** Termine la préparation sans appliquer les résultats au projet. @returns {void} */
	finish(): void {
		this.active = false;
		this.ready = true;
	}

	/** Annule l'attente sans appliquer de réponse partielle. @returns {void} */
	cancel(): void {
		this.active = false;
		this.ready = false;
		this.pending?.reject(new DOMException('', 'AbortError'));
		this.pending = null;
	}

	/** Vérifie la réponse courante, en conservant les réponses précédemment validées. @returns {void} */
	submit(): void {
		this.pending?.accept();
	}

	/**
	 * Valide tous les lots avant de laisser le parcours existant appliquer leurs réponses.
	 * @param {string} kind Fonctionnalité concernée.
	 * @param {T[]} batches Lots construits pour le parcours API.
	 * @param {(batch: T, parsed: unknown) => { errors: string[] }} validate Validateur métier existant.
	 * @param {() => string} snapshot Capture des données source pour détecter une modification.
	 * @param {string} customPromptNote Instruction personnalisée du parcours API.
	 * @returns {Promise<Map<string, { parsed: unknown; rawText: string; usage?: never }>>} Réponses validées par lot.
	 */
	async prepareBatches<T extends { batchId: string; request: unknown }>(
		kind: string,
		batches: T[],
		validate: (batch: T, parsed: unknown) => { errors: string[] },
		snapshot: () => string,
		customPromptNote = ''
	): Promise<Map<string, { parsed: unknown; rawText: string; usage?: never }>> {
		const source = snapshot();
		const responses = new Map<string, { parsed: unknown; rawText: string }>();
		this.start();
		this.totalSteps = batches.length;
		try {
			for (const batch of batches) {
				const parsed = await this.request(
					kind,
					{ batch: batch.request, customPromptNote },
					/**
					 * Refuse les réponses obsolètes ou non conformes sans appliquer de résultat partiel.
					 * @param {unknown} result Résultat extrait de l'enveloppe.
					 * @returns {unknown} Résultat conforme.
					 */
					(result) => {
						if (snapshot() !== source) throw new Error(getManualAiCopy().sourceChanged());
						const validation = validate(batch, result);
						if (validation.errors.length) throw new Error(validation.errors.join('\n'));
						return result;
					}
				);
				responses.set(batch.batchId, { parsed, rawText: JSON.stringify(parsed) });
			}
			if (snapshot() !== source) throw new Error(getManualAiCopy().sourceChanged());
			this.finish();
			return responses;
		} catch (error) {
			this.cancel();
			throw error;
		}
	}

	/**
	 * Prépare un prompt local puis attend une réponse conforme au validateur métier existant.
	 * @param {string} kind Fonctionnalité concernée.
	 * @param {Record<string, unknown>} request Données du lot, sans identifiants du fournisseur.
	 * @param {(response: unknown) => T} validate Validation complète du lot sans mutation du projet.
	 * @param {string} [prompt] Instructions déjà construites pour les appels IA côté interface.
	 * @returns {Promise<T>} Résultat validé.
	 */
	async request<T>(
		kind: string,
		request: Record<string, unknown>,
		validate: (response: unknown) => T,
		prompt?: string
	): Promise<T> {
		if (!this.active) throw new DOMException('', 'AbortError');
		let instructions: string;
		let requestId = '';
		try {
			instructions =
				prompt ?? (await invoke<string>('prepare_manual_ai_prompt', { kind, request }));
			const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(instructions));
			for (const byte of new Uint8Array(hash)) requestId += byte.toString(16).padStart(2, '0');
		} catch {
			throw new Error(getManualAiCopy().prepareError());
		}
		if (!this.active) throw new DOMException('', 'AbortError');
		// L'enveloppe identifie le contenu du prompt de façon stable entre les sessions.
		this.steps = [
			...this.steps,
			{
				prompt: `${instructions}\n\nRESPONSE ENVELOPE: Put the requested JSON result inside this exact outer object: {"requestId":"${requestId}","result":<requested JSON object>}. Copy requestId exactly. Return the complete outer JSON object only, with no Markdown or explanation.`,
				response: '',
				error: '',
				status: 'waiting'
			}
		];
		const step = this.steps[this.steps.length - 1];
		return new Promise<T>((resolve, reject) => {
			this.pending = {
				reject,
				/** Valide uniquement la réponse attendue. @returns {void} */
				accept: () => {
					try {
						let parsed: { requestId?: unknown; result?: unknown };
						try {
							const raw = step.response.trim();
							const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1).replace(
								/\\\\|\\([[\]])/g,
								/**
								 * Retire les échappements Markdown des crochets en préservant les antislashs JSON.
								 * @param {string} escape Séquence échappée.
								 * @param {string | undefined} bracket Crochet échappé en Markdown.
								 * @returns {string} Séquence JSON conservée ou crochet sans échappement.
								 */
								(escape: string, bracket: string | undefined) => bracket ?? escape
							);
							parsed = parseManualAiJson(json);
						} catch {
							throw new Error(getManualAiCopy().invalidJson());
						}
						if (!parsed || parsed.requestId !== requestId)
							throw new Error(getManualAiCopy().wrongPrompt());
						const result = validate(parsed.result);
						step.status = 'valid';
						step.error = '';
						this.pending = null;
						resolve(result);
					} catch (error) {
						step.error = error instanceof Error ? error.message : getManualAiCopy().invalidJson();
					}
				}
			};
		});
	}
}
