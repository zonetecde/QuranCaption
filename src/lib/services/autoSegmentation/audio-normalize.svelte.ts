import { invoke } from '@tauri-apps/api/core';
import { globalState } from '$lib/runes/main.svelte';
import { Duration } from '$lib/classes';
import type { Asset } from '$lib/classes';
import { WaveformService } from '$lib/services/WaveformService.svelte';

/**
 * Re-timing audio "transparent" déclenché par l'auto-segmentation.
 *
 * Contexte : certains médias annoncent une durée (PTS) plus longue que leur
 * contenu audio réel. Les moteurs d'alignement (cloud, local, Whisper, import
 * JSON, surah-splitter) travaillent sur l'audio décodé (temps réel du contenu),
 * tandis que la lecture/export de QC suit les PTS du conteneur. Les sous-titres
 * alignés dérivent donc progressivement. On régénère ici des PTS contigus sur
 * l'asset audio (sans toucher à la vidéo) pour que les deux horloges coïncident.
 *
 * Le travail tourne EN PARALLÈLE de la segmentation ; un point d'attente unique
 * (`awaitAudioNormalization`) garantit qu'il est terminé avant l'application des
 * clips à la timeline.
 */

/** Écart minimal (ms) au-delà duquel on considère l'audio comme "étiré". */
const RETIME_THRESHOLD_MS = 500;

/** État réactif minimal pour l'UI (message "Preparing audio…"). */
export const audioNormalizationStatus = $state<{ active: boolean }>({ active: false });

/** Promesse du passage de normalisation en cours (null si rien en cours). */
let normalizationPromise: Promise<void> | null = null;

/**
 * Collecte les assets audio uniques référencés par la piste audio du projet.
 *
 * @returns {Asset[]} Assets audio distincts présents sur la timeline.
 */
function collectAudioAssets(): Asset[] {
	const project = globalState.currentProject;
	const audioTrack = globalState.getAudioTrack;
	if (!project || !audioTrack) return [];

	const seen = new Set<number>();
	const assets: Asset[] = [];
	for (const clip of audioTrack.clips) {
		const assetId = (clip as { assetId?: unknown }).assetId;
		if (typeof assetId !== 'number' || seen.has(assetId)) continue;
		const asset = project.content.getAssetById(assetId);
		if (!asset?.filePath) continue;
		seen.add(assetId);
		assets.push(asset);
	}
	return assets;
}

/**
 * S'assure qu'un asset audio a des timestamps corrects, en le re-timant si besoin.
 * Idempotent : un asset déjà corrigé (`audioRetimeDone`) est ignoré.
 *
 * @param {Asset} asset Asset audio à vérifier/corriger.
 * @returns {Promise<void>}
 */
async function ensureAssetRetimed(asset: Asset): Promise<void> {
	const md = asset.metadata as Record<string, unknown>;
	if (md.audioRetimeDone === true) return;

	// Décide si un re-timing est nécessaire (détecte à la volée si inconnu — ex.
	// projets créés avant cette fonctionnalité).
	let needed = md.audioRetimeNeeded;
	if (typeof needed !== 'boolean') {
		try {
			const stretchMs = (await invoke('audio_timestamp_stretch_ms', {
				filePath: asset.filePath
			})) as number;
			needed = stretchMs > RETIME_THRESHOLD_MS;
			md.audioRetimeNeeded = needed;
		} catch (error) {
			console.warn('Audio retime detection failed:', error);
			return;
		}
	}
	if (needed !== true) return;

	try {
		await invoke('normalize_audio_timestamps', { filePath: asset.filePath });
		md.audioRetimeDone = true;
		md.audioRetimeNeeded = false;

		// Le fichier a changé sur le disque : on invalide le cache de waveform et
		// on relit la durée corrigée (plus courte) pour la timeline/preview.
		WaveformService.clearCache(asset.filePath);
		try {
			const durationMs = (await invoke('get_duration', { filePath: asset.filePath })) as number;
			if (durationMs > 0) asset.duration = new Duration(durationMs);
		} catch {
			/* la durée sera relue au prochain chargement */
		}
	} catch (error) {
		console.error('Audio timestamp normalization failed:', error);
	}
}

/**
 * Lance (sans attendre) la normalisation audio si la timeline contient un asset
 * qui en a besoin. À appeler au démarrage de chaque méthode d'auto-segmentation.
 *
 * @returns {void}
 */
export function beginAudioNormalizationIfNeeded(): void {
	// Un passage est déjà en cours : on le laisse se terminer.
	if (audioNormalizationStatus.active) return;

	const assets = collectAudioAssets().filter(
		(asset) => (asset.metadata as Record<string, unknown>).audioRetimeDone !== true
	);
	if (assets.length === 0) {
		normalizationPromise = null;
		return;
	}

	audioNormalizationStatus.active = true;
	normalizationPromise = (async () => {
		try {
			for (const asset of assets) {
				await ensureAssetRetimed(asset);
			}
		} finally {
			audioNormalizationStatus.active = false;
		}
	})();
}

/**
 * Attend la fin du re-timing audio en cours (résout immédiatement si aucun).
 * À appeler avant d'appliquer les clips à la timeline.
 *
 * @returns {Promise<void>}
 */
export async function awaitAudioNormalization(): Promise<void> {
	if (normalizationPromise) {
		try {
			await normalizationPromise;
		} catch {
			/* déjà journalisé dans ensureAssetRetimed */
		}
	}
}
