import type { BatchSegmentationSettingsSnapshot } from '$lib/classes';
import type { AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import type {
	AutoSegmentationOptions,
	LocalEngineStatus,
	LocalSegmentationStatus,
	SegmentationMode
} from './AutoSegmentation';
import { checkLocalSegmentationStatus } from './AutoSegmentation';

export type BatchSurahSplitterChoice = 'auto' | 'fixed';

export interface BatchSegmentationRunConfiguration {
	snapshot: Readonly<BatchSegmentationSettingsSnapshot>;
	mode: SegmentationMode;
	options: Readonly<AutoSegmentationOptions>;
}

/**
 * Construit un snapshot de lancement depuis les réglages persistés du wizard existant.
 * @param {AutoSegmentationSettings} settings Réglages sauvegardés actuels.
 * @param {BatchSurahSplitterChoice | undefined} surahChoice Choix explicite propre à cette exécution.
 * @param {string} runtime Runtime courant, utilisé pour refuser l'import JSON.
 * @returns {BatchSegmentationRunConfiguration} Configuration immuable sans secret persistant.
 */
export function buildBatchSegmentationRunConfiguration(
	settings: AutoSegmentationSettings,
	surahChoice?: BatchSurahSplitterChoice,
	runtime: string = settings.mode
): BatchSegmentationRunConfiguration {
	const surahSplitterSurah =
		settings.localAsrMode === 'surah_splitter' && surahChoice === 'auto'
			? null
			: settings.surahSplitterSurah;
	const model =
		settings.mode === 'api'
			? settings.cloudModel
			: settings.localAsrMode === 'legacy_whisper'
				? settings.legacyWhisperModel
				: settings.multiAlignerModel;
	const snapshot = Object.freeze({
		runtime,
		mode: settings.localAsrMode,
		model,
		device: settings.mode === 'local' ? settings.device : null,
		includeWbwTimestamps: settings.includeWbwTimestamps,
		minSilenceMs: settings.minSilenceMs,
		minSpeechMs: settings.minSpeechMs,
		padMs: settings.padMs,
		fillBySilence: settings.fillBySilence,
		extendBeforeSilence: settings.extendBeforeSilence,
		extendBeforeSilenceMs: settings.extendBeforeSilenceMs,
		surahSplitterSurah
	});
	const options = Object.freeze({
		minSilenceMs: settings.minSilenceMs,
		minSpeechMs: settings.minSpeechMs,
		padMs: settings.padMs,
		localAsrMode: settings.localAsrMode,
		legacyWhisperModel: settings.legacyWhisperModel,
		multiAlignerModel: settings.multiAlignerModel,
		cloudModel: settings.cloudModel,
		surahSplitterSurah,
		device: settings.device,
		hfToken: settings.hfToken,
		allowCloudFallback: settings.mode !== 'local',
		includeWbwTimestamps: settings.includeWbwTimestamps,
		fillBySilence: settings.fillBySilence,
		extendBeforeSilence: settings.extendBeforeSilence,
		extendBeforeSilenceMs: settings.extendBeforeSilenceMs
	});
	return Object.freeze({ snapshot, mode: settings.mode, options });
}

/**
 * Retourne le statut du moteur local correspondant au mode ASR choisi.
 * @param {AutoSegmentationSettings['localAsrMode']} mode Mode ASR local.
 * @param {LocalSegmentationStatus} status Statut complet renvoyé par le backend.
 * @returns {LocalEngineStatus | null} Moteur correspondant ou `null`.
 */
function getSelectedEngineStatus(
	mode: AutoSegmentationSettings['localAsrMode'],
	status: LocalSegmentationStatus
): LocalEngineStatus | null {
	if (!status.engines) return null;
	if (mode === 'legacy_whisper') return status.engines.legacy;
	if (mode === 'multi_aligner') return status.engines.multi;
	if (mode === 'muaalem_local') return status.engines.muaalem;
	return status.engines.surahSplitter;
}

/**
 * Valide le runtime et les dépendances locales sans rien installer.
 * @param {AutoSegmentationSettings} settings Réglages sauvegardés actuels.
 * @param {string} runtime Runtime courant du wizard.
 * @param {LocalSegmentationStatus | undefined} localStatus Statut injecté pour les tests.
 * @returns {Promise<string | null>} Code d'erreur stable ou `null`.
 */
export async function validateBatchSegmentationRuntime(
	settings: AutoSegmentationSettings,
	runtime: string = settings.mode,
	localStatus?: LocalSegmentationStatus
): Promise<string | null> {
	if (runtime === 'hf_json') return 'HF_JSON_UNSUPPORTED';
	if (settings.mode !== 'local') return null;
	const status = localStatus ?? (await checkLocalSegmentationStatus(settings.hfToken));
	const engine = getSelectedEngineStatus(settings.localAsrMode, status);
	if (engine?.tokenRequired && !engine.tokenProvided) return 'HF_TOKEN_REQUIRED';
	if (!engine?.usable) return 'LOCAL_ENGINE_UNAVAILABLE';
	return null;
}
