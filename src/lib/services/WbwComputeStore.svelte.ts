import { notifyLongTaskCompletion } from '$lib/services/UserAttentionService';

/**
 * Store de calcul des timestamps WBW détaché du cycle de vie des composants.
 *
 * Le panneau « timestamps WBW manquants » vit sous l'onglet Subtitles Editor, qui
 * est démonté dès qu'on change d'onglet dans QC (`{#if currentTab === ...}`). Un
 * `$state` local au composant serait donc détruit à chaque bascule : le bouton se
 * réarme (double calcul possible → réupload audio inutile vers l'aligner) et il n'y
 * a aucun retour de fin si l'utilisateur est ailleurs.
 *
 * En hébergeant l'état occupé ici (module `$state`, par projet), un calcul en cours
 * survit à ces bascules : au remontage le bouton retrouve son état occupé, et un
 * doublon est ignoré tant qu'un calcul tourne. À la fin, on émet une notification
 * système (même motif que l'export / la segmentation / les téléchargements audio).
 *
 * Miroir de {@link import('$lib/services/AudioDownloadStore.svelte')} sans barre de
 * progression : le calcul WBW est indéterminé (upload audio + aligner), pas un flux
 * d'octets.
 */

// Occupation par `projectId`. `$state` de module → survit au démontage des composants.
const busyByProject = $state<Record<number, boolean>>({});

/** Un calcul WBW est-il déjà en cours pour ce projet ? */
export function isWbwComputeBusy(projectId: number): boolean {
	return busyByProject[projectId] ?? false;
}

/** Résultat de fin passé à la notification (niveau optionnel, succès par défaut). */
export type WbwComputeOutcome = {
	title: string;
	body: string;
	level?: 'success' | 'error';
};

/**
 * Exécute un calcul de timestamps WBW détaché de tout composant. L'occupation vit
 * dans le store (survit aux bascules d'onglet/fenêtre) ; un doublon est ignoré tant
 * qu'un calcul est actif pour le même projet. À la fin, émet une notification système
 * (succès avec le décompte enrichi, ou échec) — l'utilisateur peut être ailleurs.
 *
 * Ne relance jamais : le travail est détaché (l'appelant peut être démonté), donc
 * toute erreur est journalisée et notifiée ici, pas propagée.
 */
export async function runWbwCompute(params: {
	projectId: number;
	errorTitle: string;
	run: () => Promise<WbwComputeOutcome>;
}): Promise<void> {
	if (busyByProject[params.projectId]) return; // garde anti-doublon.

	busyByProject[params.projectId] = true;
	try {
		const outcome = await params.run();
		// `skipWhenFocused` : notif système seulement si l'utilisateur est parti — sinon
		// il voit déjà le résultat en direct (spinner + décompte à l'écran).
		await notifyLongTaskCompletion({
			title: outcome.title,
			body: outcome.body,
			level: outcome.level ?? 'success',
			skipWhenFocused: true
		});
	} catch (error) {
		console.error('WBW compute error:', error);
		await notifyLongTaskCompletion({
			title: params.errorTitle,
			body: String(error),
			level: 'error',
			skipWhenFocused: true
		});
	} finally {
		busyByProject[params.projectId] = false;
	}
}
