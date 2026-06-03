import { resolveResource } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { globalState } from '$lib/runes/main.svelte';
import {
	isPermissionGranted,
	requestPermission,
	sendNotification
} from '@tauri-apps/plugin-notification';
import { Howl } from 'howler';

type AttentionLevel = 'success' | 'error';

let notificationIconPathPromise: Promise<string | undefined> | null = null;
let notificationSoundPathPromise: Promise<string | undefined> | null = null;
let notificationSound: Howl | null = null;

/**
 * Retourne le chemin de l'icône d'application à utiliser dans les notifications.
 *
 * @returns {Promise<string | undefined>} Chemin de l'icône ou `undefined` si indisponible.
 */
async function getNotificationIconPath(): Promise<string | undefined> {
	notificationIconPathPromise ??= (async () => {
		try {
			return await resolveResource('resources/notifications/notification-icon.png');
		} catch {
			return undefined;
		}
	})();

	return notificationIconPathPromise;
}

/**
 * Retourne le chemin du son de notification embarque.
 *
 * @returns {Promise<string | undefined>} Chemin du son ou `undefined` si indisponible.
 */
async function getNotificationSoundPath(): Promise<string | undefined> {
	notificationSoundPathPromise ??= (async () => {
		try {
			return await resolveResource('resources/notifications/notification.mp3');
		} catch {
			return undefined;
		}
	})();

	return notificationSoundPathPromise;
}

/**
 * Joue le son personnalisé associé aux notifications longues.
 *
 * @returns {Promise<void>} Promise résolue après la tentative de lecture.
 */
async function playNotificationSound(): Promise<void> {
	try {
		const soundPath = await getNotificationSoundPath();
		if (!soundPath) return;

		notificationSound ??= new Howl({
			src: [convertFileSrc(soundPath)],
			volume: 0.7
		});
		notificationSound.stop();
		notificationSound.play();
	} catch (error) {
		console.warn('Unable to play notification sound.', error);
	}
}

/**
 * Declenche un signal d'attention sur la fenetre principale.
 *
 * @param {'success' | 'error'} level Niveau de gravité à utiliser pour l'attention.
 * @returns {Promise<void>} Promise résolue une fois la demande envoyée.
 */
async function requestWindowAttention(level: AttentionLevel): Promise<void> {
	try {
		await getCurrentWindow().requestUserAttention(
			level === 'error' ? UserAttentionType.Critical : UserAttentionType.Informational
		);

		// Nettoie l'état après quelques secondes sur les environnements qui le gardent actif.
		window.setTimeout(() => {
			void getCurrentWindow().requestUserAttention(null);
		}, 12000);
	} catch (error) {
		console.warn('Unable to request window attention.', error);
	}
}

/**
 * Affiche une notification système quand le runtime l'autorise.
 *
 * @param {string} title Titre de la notification.
 * @param {string} body Contenu principal de la notification.
 * @returns {Promise<void>} Promise résolue après la tentative d'envoi.
 */
async function showDesktopNotification(title: string, body: string): Promise<void> {
	if (globalState.settings?.persistentUiState.desktopNotificationsEnabled === false) return;

	try {
		let permissionGranted = await isPermissionGranted();
		if (!permissionGranted) {
			const permission = await requestPermission();
			permissionGranted = permission === 'granted';
		}

		if (permissionGranted) {
			void playNotificationSound();
			sendNotification({
				title,
				body,
				icon: await getNotificationIconPath(),
				autoCancel: true
			});
		}
	} catch (error) {
		console.warn('Unable to show desktop notification.', error);
	}
}

/**
 * Signale à l'utilisateur qu'une opération longue est terminée.
 *
 * @param {object} params Paramètres du signal utilisateur.
 * @param {string} params.title Titre de la notification.
 * @param {string} params.body Message de détail.
 * @param {'success' | 'error'} params.level Niveau de résultat.
 * @returns {Promise<void>} Promise résolue après les tentatives d'attention et de notification.
 */
export async function notifyLongTaskCompletion(params: {
	title: string;
	body: string;
	level: AttentionLevel;
}): Promise<void> {
	if (typeof window === 'undefined') return;

	await Promise.allSettled([
		requestWindowAttention(params.level),
		showDesktopNotification(params.title, params.body)
	]);
}
