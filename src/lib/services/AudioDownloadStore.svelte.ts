import type { DownloadProgress } from '$lib/services/DownloadWithProgress';
import { notifyLongTaskCompletion } from '$lib/services/UserAttentionService';

/**
 * Store de téléchargement audio détaché du cycle de vie des composants.
 *
 * Les panneaux de téléchargement (Quranic Universal Audio, sources Quran) vivent
 * sous l'onglet Video Editor, qui est démonté dès qu'on change d'onglet dans QC
 * (`{#if currentTab === VideoEditor}`). Un `$state` local au composant serait donc
 * détruit à chaque bascule d'onglet/fenêtre : progression perdue, bouton réarmé
 * (double téléchargement possible), aucun retour de fin.
 *
 * En hébergeant l'état ici (module `$state`, hors composant), un téléchargement en
 * cours survit à ces bascules : au remontage, le bouton retrouve son état occupé
 * et sa progression. À la fin, on émet une notification système (même motif que
 * l'export / la segmentation) car l'utilisateur peut être ailleurs.
 */

/** Section émettrice — un projet peut télécharger depuis deux panneaux à la fois. */
export type AudioDownloadSection = 'qua' | 'quranSource';

/** État réactif d'un téléchargement pour un couple (projet, section). */
export type AudioDownloadEntry = {
	busy: boolean;
	label: string;
	progress: DownloadProgress | null;
};

const IDLE: AudioDownloadEntry = { busy: false, label: '', progress: null };

// Clé `${projectId}:${section}`. `$state` de module → survit au démontage des
// composants (bascule d'onglet/fenêtre dans QC).
const entries = $state<Record<string, AudioDownloadEntry>>({});

function keyOf(projectId: number, section: AudioDownloadSection): string {
	return `${projectId}:${section}`;
}

/** État courant du téléchargement (objet IDLE stable si aucun en cours). */
export function getAudioDownload(
	projectId: number,
	section: AudioDownloadSection
): AudioDownloadEntry {
	return entries[keyOf(projectId, section)] ?? IDLE;
}

/** Un téléchargement est-il déjà en cours pour ce couple (projet, section) ? */
export function isAudioDownloadBusy(projectId: number, section: AudioDownloadSection): boolean {
	return entries[keyOf(projectId, section)]?.busy ?? false;
}

/** Notification de fin fournie par le travail (titre + corps, ex. taille en Mo). */
export type AudioDownloadDone = { title: string; body: string };

/** Contexte passé au travail pour publier progression et libellé en direct. */
export type AudioDownloadContext = {
	report: (progress: DownloadProgress | null) => void;
	setLabel: (label: string) => void;
};

/**
 * Exécute un téléchargement audio détaché de tout composant. L'état vit dans le
 * store (survit aux bascules d'onglet/fenêtre) ; un doublon est ignoré tant qu'un
 * téléchargement est actif pour le même couple (projet, section). À la fin, émet
 * une notification système (succès avec la taille téléchargée, ou échec).
 *
 * Ne relance jamais : le travail est détaché (l'appelant peut être démonté), donc
 * toute erreur est journalisée et notifiée ici, pas propagée.
 */
export async function runAudioDownload(params: {
	projectId: number;
	section: AudioDownloadSection;
	label: string;
	errorTitle: string;
	run: (ctx: AudioDownloadContext) => Promise<AudioDownloadDone>;
}): Promise<void> {
	const key = keyOf(params.projectId, params.section);
	if (entries[key]?.busy) return; // garde anti-doublon.

	entries[key] = { busy: true, label: params.label, progress: null };

	const ctx: AudioDownloadContext = {
		report: (progress) => {
			const entry = entries[key];
			if (entry) entries[key] = { ...entry, progress };
		},
		setLabel: (label) => {
			const entry = entries[key];
			if (entry) entries[key] = { ...entry, label, progress: null };
		}
	};

	try {
		const done = await params.run(ctx);
		// Skip la notif système si la fenêtre est focus : la progression + fin sont déjà
		// visibles dans le bouton. Utile surtout quand l'utilisateur est parti ailleurs.
		await notifyLongTaskCompletion({
			title: done.title,
			body: done.body,
			level: 'success',
			skipWhenFocused: true
		});
	} catch (error) {
		console.error('Audio download error:', error);
		await notifyLongTaskCompletion({
			title: params.errorTitle,
			body: String(error),
			level: 'error',
			skipWhenFocused: true
		});
	} finally {
		entries[key] = { ...IDLE };
	}
}
