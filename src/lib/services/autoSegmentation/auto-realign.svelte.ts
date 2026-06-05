import { SubtitleClip } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { getAutoSegmentationAudioClips } from './audio';
import { computeWbwTimestampsForClipsSliced } from './review';
import { AUTO_REALIGN_DEBOUNCE_MS, type RealignWindow } from './types';

/**
 * Re-alignement WBW automatique et « abstrait » déclenché par les éditions de sous-titres.
 *
 * Quand l'utilisateur redimensionne un clip (au-delà d'un seuil) ou change sa plage de mots,
 * les timestamps WBW deviennent approximatifs (ou sont effacés). On relance ici MFA en arrière-plan
 * sur les seuls segments touchés (tranche audio + un seul appel), avec un debounce, une coalescence
 * des groupes qui se chevauchent, et une sémantique « dernier gagne » par clip. Un statut réactif
 * par clip pilote l'animation de la barre de mots. En cas d'échec MFA : repli silencieux sur le
 * comportement actuel (aucun toast, le clip garde son état post-édition).
 */

export type AutoRealignStatus = 'idle' | 'computing';
export type AutoRealignReason = 'drag' | 'text';

/** Statut réactif par clipId (présence = re-MFA en cours), lu par la carte pour le spinner. */
const statusByClipId = $state<Record<number, true>>({});

/**
 * Génération par clip : incrémentée à chaque planification. Permet le « dernier gagne » par clip
 * (un passage périmé n'écrase pas et ne vide pas le statut si une édition plus récente est arrivée).
 */
const clipGeneration = new Map<number, number>();

/** Groupes en attente (debounce) indexés par clé = ids triés, pour grouper l'appel API. */
type PendingGroup = { timer: ReturnType<typeof setTimeout>; clipIds: Set<number> };
const pendingGroups = new Map<string, PendingGroup>();

/**
 * Retourne le statut de re-alignement courant d'un clip.
 *
 * @param {number} clipId Identifiant du clip.
 * @returns {AutoRealignStatus} `'computing'` si un re-MFA est planifié/en cours, sinon `'idle'`.
 */
export function getAutoRealignStatus(clipId: number): AutoRealignStatus {
	return statusByClipId[clipId] ? 'computing' : 'idle';
}

/**
 * Calcule la fenêtre audio (ms, coordonnées timeline) couvrant un ensemble de clips consécutifs.
 *
 * @param {SubtitleClip[]} clips Clips concernés.
 * @returns {RealignWindow} Fenêtre `[startMs, endMs]` à trancher/téléverser.
 */
export function computeRealignWindow(clips: SubtitleClip[]): RealignWindow {
	const starts = clips.map((clip) =>
		Math.round((clip.alignmentMetadata?.timeFrom ?? clip.startTime / 1000) * 1000)
	);
	const ends = clips.map((clip) =>
		Math.round((clip.alignmentMetadata?.timeTo ?? clip.endTime / 1000) * 1000)
	);
	return { startMs: Math.min(...starts), endMs: Math.max(...ends) };
}

/**
 * Indique si deux ensembles d'ids partagent au moins un élément.
 *
 * @param {Set<number>} a Premier ensemble.
 * @param {Set<number>} b Second ensemble.
 * @returns {boolean} `true` s'il existe une intersection.
 */
function setsIntersect(a: Set<number>, b: Set<number>): boolean {
	for (const id of a) if (b.has(id)) return true;
	return false;
}

/**
 * Filtre une liste de clips pour ne garder que les `SubtitleClip` encore présents sur la piste,
 * dédupliqués par id.
 *
 * @param {SubtitleClip[]} clips Clips candidats.
 * @returns {SubtitleClip[]} Clips valides présents sur la timeline.
 */
function resolveLiveClips(clips: SubtitleClip[]): SubtitleClip[] {
	if (!globalState.currentProject) return [];
	const track = globalState.getSubtitleTrack;
	if (!track) return [];
	const present = new Set(track.clips.map((clip) => clip.id));
	const seen = new Set<number>();
	const out: SubtitleClip[] = [];
	for (const clip of clips) {
		if (!(clip instanceof SubtitleClip)) continue;
		if (!present.has(clip.id) || seen.has(clip.id)) continue;
		seen.add(clip.id);
		out.push(clip);
	}
	return out;
}

/**
 * Résout les `SubtitleClip` actuellement sur la piste à partir d'un ensemble d'ids.
 *
 * @param {Set<number>} ids Ensemble d'identifiants.
 * @returns {SubtitleClip[]} Clips correspondants encore présents.
 */
function liveSubtitleClipsByIds(ids: Set<number>): SubtitleClip[] {
	if (!globalState.currentProject) return [];
	const track = globalState.getSubtitleTrack;
	if (!track) return [];
	return track.clips.filter(
		(clip): clip is SubtitleClip => clip instanceof SubtitleClip && ids.has(clip.id)
	);
}

/**
 * Marque un ensemble de clips comme « en calcul » et incrémente leur génération.
 *
 * @param {Set<number>} clipIds Identifiants concernés.
 */
function markComputing(clipIds: Set<number>): void {
	for (const id of clipIds) {
		statusByClipId[id] = true;
		clipGeneration.set(id, (clipGeneration.get(id) ?? 0) + 1);
	}
}

/**
 * Efface le statut des clips dont la génération n'a pas changé depuis le début du passage
 * (sinon une édition plus récente est en cours et conserve le spinner).
 *
 * @param {Set<number>} clipIds Identifiants du passage.
 * @param {Map<number, number>} genAtStart Génération capturée au début du passage.
 */
function clearStatusIfUnchanged(clipIds: Set<number>, genAtStart: Map<number, number>): void {
	for (const id of clipIds) {
		if ((clipGeneration.get(id) ?? 0) === genAtStart.get(id)) {
			delete statusByClipId[id];
		}
	}
}

/**
 * Programme un re-alignement WBW en arrière-plan pour les clips donnés.
 *
 * Ignore les clips édités manuellement, sans audio, ou absents de la piste. Coalesce les groupes
 * qui se chevauchent et applique un debounce ; le spinner apparaît dès la planification. Seul le
 * dernier passage écrit/efface, par clip (« dernier gagne »).
 *
 * @param {SubtitleClip[]} clips Clips touchés par l'édition (ex. clip redimensionné + voisin).
 * @param {{ reason: AutoRealignReason }} opts Origine du déclenchement (`'drag'` ou `'text'`).
 */
export function scheduleWbwRealign(
	clips: SubtitleClip[],
	opts: { reason: AutoRealignReason }
): void {
	void opts.reason; // Conservé pour un éventuel réglage par origine ; même comportement aujourd'hui.

	const eligible = resolveLiveClips(clips).filter((clip) => !clip.wbwTimestampsManuallyEdited);
	if (eligible.length === 0) return;
	// Rien à aligner s'il n'y a pas d'audio sur la timeline.
	if (getAutoSegmentationAudioClips().length === 0) return;

	const clipIds = new Set(eligible.map((clip) => clip.id));

	// Coalescence : fusionne tout groupe en attente partageant au moins un clip (ex. drags rapides
	// d'un clip puis de son voisin) en un seul groupe contigu, pour un seul appel API.
	for (const [key, pending] of pendingGroups) {
		if (setsIntersect(pending.clipIds, clipIds)) {
			clearTimeout(pending.timer);
			pendingGroups.delete(key);
			for (const id of pending.clipIds) clipIds.add(id);
		}
	}

	markComputing(clipIds);

	const key = [...clipIds].sort((left, right) => left - right).join(',');
	const timer = setTimeout(() => {
		void runRealign(key, clipIds);
	}, AUTO_REALIGN_DEBOUNCE_MS);
	pendingGroups.set(key, { timer, clipIds });
}

/**
 * Exécute le re-alignement d'un groupe : tranche l'audio, appelle MFA, écrit les mots (par clip).
 *
 * @param {string} key Clé du groupe (ids triés).
 * @param {Set<number>} clipIds Identifiants des clips du groupe.
 * @returns {Promise<void>}
 */
async function runRealign(key: string, clipIds: Set<number>): Promise<void> {
	pendingGroups.delete(key);

	const genAtStart = new Map<number, number>();
	for (const id of clipIds) genAtStart.set(id, clipGeneration.get(id) ?? 0);

	const clips = liveSubtitleClipsByIds(clipIds);
	if (clips.length === 0) {
		clearStatusIfUnchanged(clipIds, genAtStart);
		return;
	}

	const window = computeRealignWindow(clips);

	try {
		await computeWbwTimestampsForClipsSliced(clips, {
			window,
			// « Dernier gagne » par clip : on n'écrit pas un clip réédité depuis le début du passage.
			shouldCommit: (clip) => clipGeneration.get(clip.id) === genAtStart.get(clip.id)
		});
	} catch (error) {
		// Repli silencieux : pas de toast, le clip garde son état post-édition.
		console.warn('[AutoRealign] re-MFA failed (silent fallback):', error);
	} finally {
		clearStatusIfUnchanged(clipIds, genAtStart);
	}
}
