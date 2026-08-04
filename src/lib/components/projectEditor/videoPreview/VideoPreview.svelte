<script lang="ts">
	import { ProjectEditorTabs, TrackType, AssetClip, type Asset } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Howl } from 'howler';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import { get } from 'svelte/store';
	import ShortcutService from '$lib/services/ShortcutService';
	import Settings from '$lib/classes/Settings.svelte';
	import VideoPreviewControlsBar from './VideoPreviewControlsBar.svelte';
	import VideoOverlay from './VideoOverlay.svelte';

	let {
		showControls
	}: {
		showControls: boolean;
	} = $props();

	const isLinux = $derived(navigator?.userAgent?.toLowerCase()?.includes('linux') ?? false);
	let lastTimeErrorShown = 0; // Timestamp of the last error shown (prevent spam)
	let antiCollisionNoticeCopy = $derived(
		$LL.editor as unknown as {
			antiCollisionNotice: () => string;
			antiCollisionNoticeHelpEnabled: () => string;
			antiCollisionNoticeHelpAlternative: () => string;
			antiCollisionNoticeHelpAnd: () => string;
			antiCollisionNoticeHelpTargets: () => string;
		}
	);

	let showAntiCollisionNotice = $derived(
		typeof window !== 'undefined' &&
			!window.location.pathname.includes('/exporter') &&
			Boolean(globalState.settings?.persistentUiState.showAntiCollisionNotice) &&
			Boolean(globalState.getStyle('global', 'anti-collision').value)
	);

	/**
	 * Masque définitivement l'avertissement d'anti-collision et sauvegarde ce choix.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde des paramètres.
	 */
	async function dismissAntiCollisionNotice(): Promise<void> {
		const settings = globalState.settings;
		if (!settings) return;

		settings.persistentUiState.showAntiCollisionNotice = false;
		try {
			await Settings.save();
		} catch (error) {
			settings.persistentUiState.showAntiCollisionNotice = true;
			console.error('Failed to persist anti-collision notice dismissal:', error);
			toast.error(get(LL).common.unexpectedError());
		}
	}

	// === ÉTATS RÉACTIFS DÉRIVÉS ===
	// Récupère les paramètres de la timeline depuis l'état global
	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	// Récupère l'asset vidéo actuellement sous le curseur de la timeline
	// Seulement si movePreviewTo est défini (pour éviter les recalculs inutiles)
	let currentVideo = $derived(() => {
		if (getTimelineSettings().movePreviewTo !== undefined)
			return untrack(() => {
				return globalState.currentProject!.content.timeline.getCurrentAssetOnTrack(TrackType.Video);
			});
	});

	let currentImage = $derived(() => {
		if (getTimelineSettings().movePreviewTo !== undefined)
			return untrack(() => {
				return globalState.currentProject!.content.timeline.getBackgroundImage();
			});
	});

	// Récupère l'asset audio actuellement sous le curseur de la timeline
	let currentAudio = $derived(() => {
		if (getTimelineSettings().movePreviewTo !== undefined)
			return untrack(() => {
				return globalState.currentProject!.content.timeline.getCurrentAssetOnTrack(TrackType.Audio);
			});
	});

	let currentVideoClip = $derived(() => {
		if (!globalState.currentProject) return null;
		try {
			const track = globalState.currentProject.content.timeline.tracks.find(
				(t) => t.type === TrackType.Video
			);
			return track?.getCurrentVisualClip() ?? null;
		} catch (_e) {
			return null;
		}
	});

	let isVideoLooping = $derived(() => {
		const clip = currentVideoClip();
		return clip instanceof AssetClip && clip.loopUntilAudioEnd;
	});

	let backgroundMediaStyle = $derived.by(() => {
		const mediaFill = Boolean(globalState.getStyle('global', 'media-fill')?.value);
		const scale = Math.min(
			3,
			Math.max(1, Number(globalState.getStyle('global', 'media-scale')?.value ?? 100) / 100)
		);
		const positionX =
			(Math.min(
				100,
				Math.max(-100, Number(globalState.getStyle('global', 'media-position-x')?.value ?? 0))
			) +
				100) /
			200;
		const positionY =
			(Math.min(
				100,
				Math.max(-100, Number(globalState.getStyle('global', 'media-position-y')?.value ?? 0))
			) +
				100) /
			200;

		return `position: absolute; width: ${scale * 100}% !important; height: ${scale * 100}% !important; max-width: none; left: ${-(scale - 1) * positionX * 100}%; top: ${-(scale - 1) * positionY * 100}%; object-fit: ${mediaFill ? 'cover' : 'contain'}; object-position: ${positionX * 100}% ${positionY * 100}%;`;
	});

	// === ÉTATS LOCAUX ===
	let videoElement = $state<HTMLVideoElement | null>(null); // Référence à l'élément <video> HTML
	type VideoClipTransitionMode = 'none' | 'fade-through-black' | 'crossfade';

	// === EFFETS RÉACTIFS ===

	// Effect qui redimensionne la vidéo quand la hauteur de la prévisualisation change
	$effect(() => {
		const _ = globalState.settings?.persistentUiState.projectEditorLayout.upperSectionHeight;

		resizeVideoToFitScreen();
	});

	// Effect qui recharge l'audio uniquement quand l'asset ou son contenu change
	$effect(() => {
		const audio = currentAudio();
		const audioKey = audio ? `${audio.id}:${audio.filePath}:${audio.mediaReloadToken}` : null;
		untrack(() => {
			if (audioKey === loadedAudioKey) return;
			loadedAudioKey = audioKey;
			void setupAudio();
		});
	});

	$effect(() => {
		const volumePercent = globalState.getAudioTrack.volumePercent;
		untrack(() => applyAudioVolume(volumePercent));
	});

	// Effect principal de synchronisation - se déclenche quand le curseur bouge
	$effect(() => {
		if (globalState.currentProject?.projectEditorState.timeline.movePreviewTo) {
			untrack(() => {
				syncMediaToCursorPosition();
			});
		}
	});

	// Effect pour que le scroll soit automatique afin de suivre le curseur dans la timeline
	$effect(() => {
		if (getTimelineSettings().cursorPosition) {
			untrack(() => {
				if (!isPlaying) return;

				// Scroll jusqu'à la position du curseur
				const element = document.getElementById('cursor');
				const timeline = document.getElementById('timeline');

				if (element && timeline) {
					// Met le scroll à 0
					timeline.scrollLeft = 0;

					// Récupère la position du curseur par rapport à la timeline
					const cursorPositionRelativeToTimeline =
						element.getBoundingClientRect().left - timeline.getBoundingClientRect().left;

					const newScrollLeftPos = cursorPositionRelativeToTimeline - window.innerWidth / 2 + 300;

					// Scroll pour suivre le curseur
					timeline.scrollTo({
						left: newScrollLeftPos
					});
				}
			});
		}
	});

	// === FONCTIONS DE CALCUL DE TEMPS ===

	/**
	 * Calcule le temps à jouer dans l'audio en fonction de la position du curseur
	 * @returns Temps en secondes dans l'audio
	 */
	function getCurrentAudioTimeToPlay(): number {
		const currentClip = globalState.getAudioTrack.getCurrentClip();

		if (!currentClip) return 0;

		// Le temps dans l'audio = position du curseur - début du clip
		const timeInClip = getTimelineSettings().movePreviewTo - currentClip.startTime;
		return Math.max(0, timeInClip / 1000); // Convertit en secondes pour les lecteurs audio
	}

	/**
	 * Calcule le temps à jouer dans la vidéo en fonction de la position du curseur
	 * @returns Temps en secondes dans la vidéo
	 */
	function getCurrentVideoTimeToPlay(): number {
		const track = globalState.getVideoTrack;
		const refTime = getTimelineSettings().movePreviewTo ?? getTimelineSettings().cursorPosition;
		const currentClip = track.getCurrentVisualClip(refTime);
		const asset = currentVideo();

		if (!currentClip || !asset) return 0;

		// Le temps dans la vidéo suit le début visuel pour rester aligné avec le crossfade exporté.
		const clipIndex = track.clips.findIndex((trackClip) => trackClip.id === currentClip.id);
		const visualStartTime =
			clipIndex === -1 ? currentClip.startTime : track.getVisualClipStartTime(clipIndex);
		let timeInClip = refTime - visualStartTime;

		if (isVideoLooping() && !asset.duration.isNull()) {
			timeInClip = timeInClip % asset.duration.ms;
		}

		return Math.max(0, timeInClip / 1000); // Convertit en secondes pour l'élément video HTML
	}

	/**
	 * Libere les lecteurs qui utilisent un fichier avant son remplacement sur disque.
	 *
	 * @param {Event} event Evenement global contenant le chemin du fichier.
	 * @returns {void}
	 */
	function releaseAssetMedia(event: Event): void {
		const filePath = (event as CustomEvent<{ filePath?: string }>).detail?.filePath;
		if (!filePath) return;

		const usesReleasedFile =
			currentAudio()?.filePath === filePath ||
			currentVideo()?.filePath === filePath ||
			currentImage()?.filePath === filePath;
		if (!usesReleasedFile) return;

		pause();
		if (nativeAudioReady) {
			nativeAudioSetupId++;
			nativeAudioReady = false;
			loadedAudioKey = undefined;
			stopNativeAudioClock();
			void controlNativeAudio('unload').catch((error) =>
				console.error('Native audio unload error:', error)
			);
		}
		if (audioHowl) {
			audioHowl.unload();
			audioHowl = null;
		}
		if (videoElement) {
			videoElement.pause();
			videoElement.removeAttribute('src');
			videoElement.load();
		}
	}

	onDestroy(() => {
		nativeAudioSetupId++;
		nativeAudioReady = false;
		stopNativeAudioClock();
		void controlNativeAudio('unload').catch((error) =>
			console.error('Native audio unload error:', error)
		);
		if (audioHowl) {
			audioHowl.unload(); // Libère les ressources audio
			audioHowl = null;
		}

		window.removeEventListener('resize', resizeVideoToFitScreen);
		window.removeEventListener('qurancaption-release-asset-media', releaseAssetMedia);
	});

	// === CYCLE DE VIE DU COMPOSANT ===
	onMount(() => {
		resizeVideoToFitScreen(); // Redimensionne initial
		window.addEventListener('resize', resizeVideoToFitScreen); // Écoute le redimensionnement de fenêtre
		window.addEventListener('qurancaption-release-asset-media', releaseAssetMedia);

		// Force la synchronisation initiale vidéo/audio avec la position du curseur
		triggerVideoAndAudioToFitCursor();
		// Set les shortcuts pour le preview
		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.VIDEO_PREVIEW.PLAY_PAUSE,
			onKeyDown: (_e) => {
				togglePlayPause();
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.VIDEO_PREVIEW.MOVE_FORWARD,
			onKeyDown: (_e) => {
				const currentTime = getTimelineSettings().cursorPosition;
				getTimelineSettings().cursorPosition = currentTime + 2000; // Avance de 2 secondes
				getTimelineSettings().movePreviewTo = currentTime + 2000;
				globalState.getVideoPreviewState.scrollTimelineToCursor();
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.VIDEO_PREVIEW.MOVE_BACKWARD,
			onKeyDown: (_e) => {
				const currentTime = getTimelineSettings().cursorPosition;
				getTimelineSettings().cursorPosition = Math.max(1, currentTime - 2000); // Recule de 2 secondes
				getTimelineSettings().movePreviewTo = Math.max(1, currentTime - 2000);
				globalState.getVideoPreviewState.scrollTimelineToCursor();
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.VIDEO_PREVIEW.INCREASE_SPEED,
			onKeyDown: (_e) => {
				setPlaybackSpeed(getSpeed() + 1);
			},
			onKeyUp: (_e) => {
				setPlaybackSpeed(getSpeed());
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.VIDEO_PREVIEW.TOGGLE_FULLSCREEN,
			onKeyDown: (_e) => {
				globalState.getVideoPreviewState.toggleFullScreen();
			}
		});

		ShortcutService.registerShortcut({
			key: globalState.settings!.shortcuts.VIDEO_PREVIEW.GO_TO_START,
			onKeyDown: (_e) => {
				pause(); // Arrête la lecture
				getTimelineSettings().cursorPosition = 1; // Revient au début (1ms pour éviter les bugs)
				getTimelineSettings().movePreviewTo = 1; // Force la mise à jour de la prévisualisation
				globalState.getVideoPreviewState.scrollTimelineToCursor();
			}
		});
	});

	function setPlaybackSpeed(speed: number) {
		if (nativeAudioReady && isPlaying) {
			nativeAudioBasePositionMs = getNativeAudioPosition();
			nativeAudioBaseTime = performance.now();
		}
		audioSpeed = speed; // Met à jour la vitesse audio
		if (videoElement) {
			videoElement.playbackRate = speed;
		}
		if (nativeAudioReady) {
			void controlNativeAudio('setSpeed', { speed }).catch((error) =>
				console.error('Native audio speed error:', error)
			);
		} else if (audioHowl) {
			audioHowl.rate(speed);
		}
	}

	$effect(() => {
		const speed = getSpeed();
		untrack(() => {
			setPlaybackSpeed(speed);
		});
	});

	function getSpeed() {
		let speed = globalState.getSubtitlesEditorState.playbackSpeed;
		if (globalState.shared.wbwEdit.active) {
			speed = globalState.getSubtitlesEditorState.wbwPlaybackSpeed;
		}
		if (
			!globalState.shared.wbwEdit.active &&
			globalState.currentProject?.projectEditorState.currentTab !==
				ProjectEditorTabs.SubtitlesEditor
		) {
			speed = 1; // Réinitialise la vitesse si on n'est pas dans l'éditeur de sous-titres
		}
		return speed;
	}

	onDestroy(() => {
		pause(); // Met en pause la lecture pour éviter les fuites de mémoire

		// Supprime la div de fond fullscreen si elle existe
		const backgroundDiv = document.getElementById('fullscreen-background');
		if (backgroundDiv) {
			backgroundDiv.remove();
		}

		// Enlève tout les shortcuts enregistrés
		ShortcutService.unregisterShortcut(globalState.settings!.shortcuts.VIDEO_PREVIEW.PLAY_PAUSE);
		ShortcutService.unregisterShortcut(globalState.settings!.shortcuts.VIDEO_PREVIEW.MOVE_FORWARD);
		ShortcutService.unregisterShortcut(globalState.settings!.shortcuts.VIDEO_PREVIEW.MOVE_BACKWARD);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.VIDEO_PREVIEW.INCREASE_SPEED
		);
		ShortcutService.unregisterShortcut(
			globalState.settings!.shortcuts.VIDEO_PREVIEW.TOGGLE_FULLSCREEN
		);
		ShortcutService.unregisterShortcut(globalState.settings!.shortcuts.VIDEO_PREVIEW.GO_TO_START);
	});

	// Effect pour s'assurer que l'événement ontimeupdate est toujours assigné à l'élément vidéo
	$effect(() => {
		if (videoElement) {
			videoElement.ontimeupdate = handleVideoTimeUpdate;
		}
	});

	/**
	 * Force le déclenchement de la synchronisation en modifiant movePreviewTo
	 * Trick pour déclencher l'effect de synchronisation
	 */
	function triggerVideoAndAudioToFitCursor() {
		getTimelineSettings().movePreviewTo = getTimelineSettings().cursorPosition + 1;
	}

	// === GESTION DES MISES À JOUR DE TEMPS ===

	/**
	 * Gestionnaire principal pour les mises à jour du curseur de la timeline
	 * Priorité à l'audio si disponible, sinon utilise la vidéo
	 */
	function handleVideoTimeUpdate() {
		if (nativeAudioReady) return;
		if (audioUpdateInterval) {
			// Si on a un intervalle de mise à jour audio, on l'utilise car plus précis
			handleAudioTimeUpdate();
			return;
		}

		// Utilise la vidéo pour mettre à jour le curseur de la timeline
		if (videoElement && videoElement.currentTime !== undefined && isPlaying) {
			const currentClip = globalState.getVideoTrack.getCurrentClip();

			if (currentClip) {
				if (isVideoLooping()) {
					return;
				}

				// La position du curseur = début du clip + temps écoulé dans la vidéo (en ms)
				const absolutePosition = currentClip.startTime + videoElement.currentTime * 1000;
				getTimelineSettings().cursorPosition = absolutePosition;
			}
		}
	}

	/**
	 * Met à jour le curseur de la timeline basé sur la position de l'audio
	 * Plus précis que la vidéo pour la synchronisation
	 */
	function handleAudioTimeUpdate() {
		if (audioHowl && isPlaying) {
			const currentAudioClip = globalState.getAudioTrack?.getCurrentClip();

			if (currentAudioClip) {
				// .seek() retourne la position en secondes, on la convertit en ms
				const audioPositionMs = audioHowl.seek() * 1000;
				const absolutePosition = currentAudioClip.startTime + audioPositionMs;
				getTimelineSettings().cursorPosition = absolutePosition;
			}
		}
	}

	// === GESTION DU REDIMENSIONNEMENT ===

	/**
	 * Redimensionne la vidéo pour qu'elle s'adapte au conteneur sans déformation
	 * Utilise un système de mise à l'échelle avec ratio préservé
	 * La preview reste basée sur 1920x1080 mais avec le bon ratio de sortie
	 */
	function resizeVideoToFitScreen() {
		if (!globalState.currentProject) return;

		const previewContainer = document.getElementById('preview-container');
		const preview = document.getElementById('preview');

		const outputDimension = globalState.getStyle('global', 'video-dimension')!.value as {
			width: number;
			height: number;
		};

		if (previewContainer && preview) {
			// Calcul du ratio de sortie
			const outputRatio = outputDimension.width / outputDimension.height;
			const baseRatio = 16 / 9; // Ratio de référence (1920x1080)

			let previewWidth: number;
			let previewHeight: number;

			if (Math.abs(outputRatio - baseRatio) < 0.01) {
				// Si le ratio de sortie est 16:9 (ou très proche), utiliser 1920x1080
				previewWidth = 1920;
				previewHeight = 1080;
			} else {
				// Sinon, adapter 1920x1080 au ratio de sortie
				if (outputRatio > baseRatio) {
					// Format plus large que 16:9 (ex: 21:9)
					previewWidth = 1920;
					previewHeight = Math.round(1920 / outputRatio);
				} else {
					// Format plus haut que 16:9 (ex: 9:16 portrait)
					previewHeight = 1080;
					previewWidth = Math.round(1080 * outputRatio);
				}
			}

			// Configuration initiale avec les dimensions de preview calculées
			preview.style.width = `${previewWidth}px`;
			preview.style.height = `${previewHeight}px`;
			preview.style.minWidth = `${previewWidth}px`;
			preview.style.minHeight = `${previewHeight}px`;

			// Configuration du conteneur
			previewContainer.style.width = 'auto';
			previewContainer.style.height = globalState.getVideoPreviewState.isFullscreen
				? '100vh'
				: 'calc(100%)';

			// Reset des transformations précédentes
			previewContainer.style.position = 'relative';
			previewContainer.style.zIndex = '0';
			previewContainer.style.transform = 'none';
			previewContainer.style.top = '0';
			previewContainer.style.left = '0';

			let targetW: number;
			let targetH: number;
			if (globalState.getVideoPreviewState.isFullscreen) {
				// Créer ou récupérer la div de fond
				let backgroundDiv = document.getElementById('fullscreen-background');
				if (!backgroundDiv) {
					backgroundDiv = document.createElement('div');
					backgroundDiv.id = 'fullscreen-background';
					backgroundDiv.style.position = 'absolute';
					backgroundDiv.style.top = '0';
					backgroundDiv.style.left = '0';
					backgroundDiv.style.width = '100vw';
					backgroundDiv.style.height = '100vh';
					backgroundDiv.style.zIndex = '9998';
					backgroundDiv.style.backgroundColor = '#11151c';
					backgroundDiv.style.background =
						'repeating-linear-gradient(45deg, #161b22, #161b22 5px, #11151c 5px, #11151c 25px)';
					document.body.appendChild(backgroundDiv);
				}

				// Mode plein écran: fit (letterbox) pour voir toute la vidéo avec des bandes noires
				const screenW = window.innerWidth;
				const screenH = window.innerHeight;
				const scaleFit = Math.min(screenW / previewWidth, screenH / previewHeight);
				targetW = previewWidth * scaleFit;
				targetH = previewHeight * scaleFit;

				preview.style.transform = `scale(${scaleFit})`;
				previewContainer.style.width = `${targetW}px`;
				previewContainer.style.height = `${targetH}px`;
				previewContainer.style.position = 'fixed';
				previewContainer.style.top = '50%';
				previewContainer.style.left = '50%';
				previewContainer.style.transform = 'translate(-50%, -50%)';
				previewContainer.style.zIndex = '9999';
				previewContainer.style.background = 'black';
			} else {
				// Supprimer la div de fond si elle existe
				const backgroundDiv = document.getElementById('fullscreen-background');
				if (backgroundDiv) {
					backgroundDiv.remove();
				}
				// Mode normal: fit (letterbox) centré
				const containerWidth = previewContainer.clientWidth;
				const containerHeight = previewContainer.clientHeight;
				const widthRatio = containerWidth / previewWidth;
				const heightRatio = containerHeight / previewHeight;
				const scaleFit = Math.min(widthRatio, heightRatio);
				preview.style.transform = `scale(${scaleFit})`;
				previewContainer.style.width = `${previewWidth * scaleFit}px`;
				previewContainer.style.height = `${previewHeight * scaleFit}px`;
				previewContainer.style.left = '50%';
				previewContainer.style.top = '50%';
				previewContainer.style.position = 'relative';
				previewContainer.style.transform = 'translate(-50%, -50%)';
			}
		}

		untrack(() => {
			globalState.updateVideoPreviewUI();
		});
	}

	// === GESTION AUDIO NATIVE AVEC FALLBACK HOWLER ===
	type NativePreviewAudioAction =
		| 'load'
		| 'play'
		| 'pause'
		| 'seek'
		| 'setVolume'
		| 'setSpeed'
		| 'status'
		| 'unload';
	type NativePreviewAudioStatus = {
		loaded: boolean;
		playing: boolean;
		ended: boolean;
		positionMs: number;
		durationMs: number;
		speed: number;
	};
	type NativePreviewAudioOptions = {
		filePath?: string;
		positionMs?: number;
		volume?: number;
		speed?: number;
	};
	type BoostedMediaElement = HTMLMediaElement & {
		__quranCaptionAudioBoost?: {
			context: AudioContext;
			source: MediaElementAudioSourceNode;
			gain: GainNode;
		};
	};

	let audioHowl: Howl | null = null; // Instance Howler pour la lecture audio
	let audioBoostContext: AudioContext | null = null;
	let isPlaying = $state(false); // État de lecture global
	let audioUpdateInterval: ReturnType<typeof setInterval> | null = null; // Intervalle pour la mise à jour du curseur audio
	let audioSpeed = $state(1); // Vitesse de lecture audio
	let loadedAudioKey: string | null | undefined;
	let nativeAudioReady = false;
	let nativeAudioSetupId = 0;
	let nativeAudioSeekId = 0;
	let nativeAudioAnimationFrame: number | null = null;
	let nativeAudioSyncInterval: ReturnType<typeof setInterval> | null = null;
	let nativeAudioStatusPending = false;
	let nativeAudioBasePositionMs = 0;
	let nativeAudioBaseTime = 0;
	let nativeAudioDurationMs = 0;
	let nativeAudioClipStartTime = 0;
	let nativeAudioEndHandled = false;
	let transitionAnimationFrame: number | null = null;
	let transitionRenderCursorPosition = $state(0);

	/**
	 * Envoie une commande au lecteur audio natif Tauri.
	 * @param {NativePreviewAudioAction} action Action à exécuter.
	 * @param {NativePreviewAudioOptions} options Paramètres facultatifs de la commande.
	 * @returns {Promise<NativePreviewAudioStatus>} État du lecteur après la commande.
	 */
	function controlNativeAudio(
		action: NativePreviewAudioAction,
		options: NativePreviewAudioOptions = {}
	): Promise<NativePreviewAudioStatus> {
		return invoke<NativePreviewAudioStatus>('control_preview_audio', {
			action,
			filePath: options.filePath ?? null,
			positionMs: options.positionMs ?? null,
			volume: options.volume ?? null,
			speed: options.speed ?? null
		});
	}

	/**
	 * Retourne le volume effectif de la preview sous forme linéaire.
	 * @param {number} volumePercent Volume de piste demandé entre 0 et 200.
	 * @returns {number} Volume natif entre 0 et 2.
	 */
	function getNativeAudioVolume(volumePercent: number): number {
		if (globalState.getVideoPreviewState.showVideosAndAudios) return 0;
		return Math.min(2, Math.max(0, volumePercent / 100));
	}

	/**
	 * Recale l'horloge locale sur un instantané retourné par Rust.
	 * @param {NativePreviewAudioStatus} status État courant du lecteur natif.
	 * @returns {void}
	 */
	function applyNativeAudioStatus(status: NativePreviewAudioStatus): void {
		nativeAudioBasePositionMs = status.positionMs;
		nativeAudioDurationMs = status.durationMs;
		nativeAudioBaseTime = performance.now();
		if (!status.ended) nativeAudioEndHandled = false;
	}

	/**
	 * Passe une seule fois au média suivant lorsque l'audio natif se termine.
	 * @returns {void}
	 */
	function handleNativeAudioEnd(): void {
		if (nativeAudioEndHandled) return;
		nativeAudioEndHandled = true;
		stopNativeAudioClock();
		goNextAudio();
	}

	/**
	 * Calcule la position source courante entre deux synchronisations Rust.
	 * @returns {number} Position courante dans l'audio en millisecondes.
	 */
	function getNativeAudioPosition(): number {
		return nativeAudioBasePositionMs + (performance.now() - nativeAudioBaseTime) * audioSpeed;
	}

	/**
	 * Met à jour le curseur à la fréquence d'affichage depuis l'horloge audio native.
	 * @returns {void}
	 */
	function updateNativeAudioClock(): void {
		if (!nativeAudioReady || !isPlaying) {
			nativeAudioAnimationFrame = null;
			return;
		}

		const positionMs = getNativeAudioPosition();
		if (nativeAudioDurationMs > 0 && positionMs >= nativeAudioDurationMs) {
			getTimelineSettings().cursorPosition = nativeAudioClipStartTime + nativeAudioDurationMs;
			handleNativeAudioEnd();
			return;
		}

		getTimelineSettings().cursorPosition = nativeAudioClipStartTime + positionMs;
		nativeAudioAnimationFrame = requestAnimationFrame(updateNativeAudioClock);
	}

	/**
	 * Corrige périodiquement la légère dérive de l'horloge d'affichage.
	 * @returns {Promise<void>} Promesse résolue après la lecture de l'état natif.
	 */
	async function refreshNativeAudioStatus(): Promise<void> {
		if (!nativeAudioReady || !isPlaying || nativeAudioStatusPending) return;
		nativeAudioStatusPending = true;
		const setupId = nativeAudioSetupId;
		try {
			const status = await controlNativeAudio('status');
			if (setupId !== nativeAudioSetupId || !nativeAudioReady || !isPlaying) return;
			applyNativeAudioStatus(status);
			if (status.ended) handleNativeAudioEnd();
		} catch (error) {
			console.error('Native audio status error:', error);
		} finally {
			nativeAudioStatusPending = false;
		}
	}

	/**
	 * Démarre l'horloge d'affichage synchronisée avec le lecteur natif.
	 * @param {NativePreviewAudioStatus} status État natif servant de point de départ.
	 * @returns {void}
	 */
	function startNativeAudioClock(status: NativePreviewAudioStatus): void {
		applyNativeAudioStatus(status);
		if (nativeAudioAnimationFrame === null) {
			nativeAudioAnimationFrame = requestAnimationFrame(updateNativeAudioClock);
		}
		if (nativeAudioSyncInterval === null) {
			nativeAudioSyncInterval = setInterval(refreshNativeAudioStatus, 250);
		}
	}

	/**
	 * Arrête les mises à jour frontend de la position audio native.
	 * @returns {void}
	 */
	function stopNativeAudioClock(): void {
		if (nativeAudioAnimationFrame !== null) {
			cancelAnimationFrame(nativeAudioAnimationFrame);
			nativeAudioAnimationFrame = null;
		}
		if (nativeAudioSyncInterval !== null) {
			clearInterval(nativeAudioSyncInterval);
			nativeAudioSyncInterval = null;
		}
	}

	/**
	 * Bascule sur Howler lorsqu'une opération native n'est pas prise en charge.
	 * @param {unknown} error Erreur ayant provoqué le fallback.
	 * @returns {Promise<void>} Promesse résolue une fois le fallback prêt.
	 */
	async function activateHowlerFallback(error: unknown): Promise<void> {
		const audioAsset = currentAudio();
		if (!audioAsset) return;
		console.warn('Native audio unavailable, using Howler fallback:', error);
		nativeAudioSetupId++;
		nativeAudioSeekId++;
		nativeAudioReady = false;
		stopNativeAudioClock();
		try {
			await controlNativeAudio('unload');
		} catch (_unloadError) {
			// Le fallback reste utilisable même si le thread natif est indisponible.
		}
		if (audioHowl) audioHowl.unload();
		const fallbackAudio = setupHowlerFallback(audioAsset);
		if (isPlaying) fallbackAudio.play();
	}

	/**
	 * Lance le lecteur natif directement à la position courante de la timeline.
	 * @returns {Promise<void>} Promesse résolue une fois la lecture démarrée.
	 */
	async function playNativeAudioAtCursor(): Promise<void> {
		const setupId = nativeAudioSetupId;
		const currentAudioClip = globalState.getAudioTrack.getCurrentClip();
		const audioAsset = currentAudio();
		if (!audioAsset) return;
		if (currentAudioClip) nativeAudioClipStartTime = currentAudioClip.startTime;
		try {
			const status = await controlNativeAudio('play', {
				filePath: audioAsset.filePath,
				positionMs: getCurrentAudioTimeToPlay() * 1000,
				volume: getNativeAudioVolume(globalState.getAudioTrack.volumePercent),
				speed: audioSpeed
			});
			if (setupId === nativeAudioSetupId && nativeAudioReady && isPlaying) {
				startNativeAudioClock(status);
			}
		} catch (error) {
			console.error('Native audio play error:', error);
			await activateHowlerFallback(error);
		}
	}

	/**
	 * Positionne le lecteur natif sur le curseur sans recharger le fichier.
	 * @param {boolean} shouldKeepPlaying Indique si la lecture doit continuer après le seek.
	 * @returns {Promise<void>} Promesse résolue après le repositionnement.
	 */
	async function seekNativeAudioToCursor(shouldKeepPlaying: boolean): Promise<void> {
		const setupId = nativeAudioSetupId;
		const seekId = ++nativeAudioSeekId;
		try {
			const status = await controlNativeAudio('seek', {
				positionMs: getCurrentAudioTimeToPlay() * 1000
			});
			if (setupId !== nativeAudioSetupId || seekId !== nativeAudioSeekId || !nativeAudioReady) {
				return;
			}
			if (shouldKeepPlaying && !status.playing) {
				await playNativeAudioAtCursor();
			} else if (shouldKeepPlaying) {
				startNativeAudioClock(status);
			} else {
				applyNativeAudioStatus(status);
			}
		} catch (error) {
			console.error('Native audio seek error:', error);
			await activateHowlerFallback(error);
		}
	}

	/**
	 * Met en pause le lecteur natif et reporte sa position exacte dans la timeline.
	 * @returns {Promise<void>} Promesse résolue après la pause native.
	 */
	async function pauseNativeAudio(): Promise<void> {
		const setupId = nativeAudioSetupId;
		const cursorAtRequest = getTimelineSettings().cursorPosition;
		try {
			const status = await controlNativeAudio('pause');
			if (
				setupId !== nativeAudioSetupId ||
				!nativeAudioReady ||
				isPlaying ||
				getTimelineSettings().cursorPosition !== cursorAtRequest
			) {
				return;
			}
			applyNativeAudioStatus(status);
			getTimelineSettings().cursorPosition = nativeAudioClipStartTime + status.positionMs;
			getTimelineSettings().movePreviewTo = getTimelineSettings().cursorPosition;
		} catch (error) {
			console.error('Native audio pause error:', error);
		}
	}

	let videoClipTransitionMode = $derived(() => {
		return String(
			globalState.getStyle('global', 'video-clip-transition')?.value ?? 'none'
		) as VideoClipTransitionMode;
	});

	let videoClipTransitionDurationMs = $derived(() => {
		return Math.max(
			0,
			Number(globalState.getStyle('global', 'video-clip-transition-duration')?.value ?? 0)
		);
	});

	let videoClipTransitionState = $derived(() => {
		const mode = videoClipTransitionMode();
		const durationMs = videoClipTransitionDurationMs();
		const cursorPosition =
			isPlaying && mode !== 'none' && durationMs > 0
				? transitionRenderCursorPosition
				: getTimelineSettings().cursorPosition;
		const clip = globalState.getVideoTrack.getCurrentVisualClip(cursorPosition);
		const emptyState = {
			currentOpacity: 1,
			showCrossfadeNotice: false
		};

		if (!(clip instanceof AssetClip) || mode === 'none' || durationMs <= 0) return emptyState;

		const videoClips = globalState.getVideoTrack.clips.filter(
			(trackClip): trackClip is AssetClip => trackClip instanceof AssetClip
		);
		const currentIndex = videoClips.findIndex((trackClip) => trackClip.id === clip.id);
		const visualStartTime =
			currentIndex === -1
				? clip.startTime
				: globalState.getVideoTrack.getVisualClipStartTime(currentIndex);
		const visualEndTime = visualStartTime + clip.duration;
		const clipDurationMs = Math.max(1, clip.endTime - clip.startTime);
		const effectiveDurationMs = Math.min(durationMs, clipDurationMs);
		const timeFromStartMs = Math.max(0, cursorPosition - visualStartTime);
		const timeToEndMs = Math.max(0, visualEndTime - cursorPosition);
		const startProgress = Math.min(1, timeFromStartMs / effectiveDurationMs);
		const endProgress = Math.min(1, timeToEndMs / effectiveDurationMs);

		if (mode === 'fade-through-black') {
			return {
				...emptyState,
				currentOpacity: Math.min(startProgress, endProgress)
			};
		}

		if (timeFromStartMs < effectiveDurationMs && currentIndex > 0) {
			return {
				...emptyState,
				showCrossfadeNotice: true
			};
		}

		return emptyState;
	});

	$effect(() => {
		const shouldRun =
			isPlaying && videoClipTransitionMode() !== 'none' && videoClipTransitionDurationMs() > 0;

		if (shouldRun) {
			startTransitionAnimationClock();
		} else {
			stopTransitionAnimationClock();
		}
	});

	export function togglePlayPause() {
		if (isPlaying) {
			pause();
		} else {
			play(true);
		}
	}

	/**
	 * Retourne la position de lecture actuelle pour animer les transitions de preview.
	 *
	 * @returns {number} Position courante en millisecondes.
	 */
	function getPreviewRenderCursorPosition(): number {
		if (nativeAudioReady) return getTimelineSettings().cursorPosition;

		const audioClip = globalState.getAudioTrack?.getCurrentClip();
		if (audioHowl && audioClip) {
			return audioClip.startTime + audioHowl.seek() * 1000;
		}

		const videoClip = currentVideoClip();
		if (videoElement && videoClip) {
			const clipIndex = globalState.getVideoTrack.clips.findIndex(
				(trackClip) => trackClip.id === videoClip.id
			);
			const visualStartTime =
				clipIndex === -1
					? videoClip.startTime
					: globalState.getVideoTrack.getVisualClipStartTime(clipIndex);
			return visualStartTime + videoElement.currentTime * 1000;
		}

		return getTimelineSettings().cursorPosition;
	}

	/**
	 * Anime les opacités de transition avec requestAnimationFrame.
	 *
	 * @returns {void}
	 */
	function startTransitionAnimationClock(): void {
		if (transitionAnimationFrame !== null) return;

		transitionRenderCursorPosition = getPreviewRenderCursorPosition();
		const tick = () => {
			transitionRenderCursorPosition = getPreviewRenderCursorPosition();
			if (
				isPlaying &&
				videoClipTransitionMode() !== 'none' &&
				videoClipTransitionDurationMs() > 0
			) {
				transitionAnimationFrame = requestAnimationFrame(tick);
			} else {
				transitionAnimationFrame = null;
			}
		};

		transitionAnimationFrame = requestAnimationFrame(tick);
	}

	/**
	 * Arrête l'horloge de transition de preview.
	 *
	 * @returns {void}
	 */
	function stopTransitionAnimationClock(): void {
		if (transitionAnimationFrame === null) return;

		cancelAnimationFrame(transitionAnimationFrame);
		transitionAnimationFrame = null;
	}

	/**
	 * Retourne le message affiché quand le crossfade est ignoré en preview.
	 *
	 * @returns {string} Message localisé de preview crossfade.
	 */
	function getCrossfadePreviewNotice(): string {
		return (
			get(LL).editor as unknown as {
				crossfadePreviewNotice: () => string;
			}
		).crossfadePreviewNotice();
	}

	/**
	 * Applique le volume de la piste au lecteur natif ou au fallback Howler.
	 * @param {number} volumePercent Volume demandé entre 0 et 200.
	 * @returns {void}
	 */
	function applyAudioVolume(volumePercent: number): void {
		if (nativeAudioReady) {
			void controlNativeAudio('setVolume', {
				volume: getNativeAudioVolume(volumePercent)
			}).catch((error) => console.error('Native audio volume error:', error));
			return;
		}
		if (!audioHowl) return;

		const volume = Math.min(2, Math.max(0, volumePercent / 100));
		audioHowl.volume(Math.min(1, volume));
		const node = (
			audioHowl as unknown as {
				_sounds?: Array<{ _node?: GainNode | HTMLMediaElement }>;
			}
		)._sounds?.[0]?._node;

		if (node instanceof HTMLMediaElement) {
			const mediaElement = node as BoostedMediaElement;
			if (mediaElement.crossOrigin !== 'anonymous') {
				// Web Audio exige une requête CORS explicite pour les URLs du protocole asset Tauri.
				mediaElement.crossOrigin = 'anonymous';
				mediaElement.load();
			}
			let boost = mediaElement.__quranCaptionAudioBoost;
			if (volume > 1 && !boost) {
				try {
					const context = new AudioContext();
					const source = context.createMediaElementSource(mediaElement);
					const gain = context.createGain();
					source.connect(gain).connect(context.destination);
					boost = { context, source, gain };
					mediaElement.__quranCaptionAudioBoost = boost;
				} catch (error) {
					console.warn('Unable to amplify the reused HTML audio element:', error);
					return;
				}
			}
			if (boost) {
				boost.gain.gain.value = Math.max(1, volume);
				audioBoostContext = boost.context;
			}
			return;
		}

		if (node?.gain) node.gain.value = volume;
	}

	/**
	 * Configure le fallback Howler lorsqu'un format n'est pas lu nativement.
	 * @param {Asset} audioAsset Asset à lire avec Howler.
	 * @returns {Howl} Instance Howler prête à être utilisée.
	 */
	function setupHowlerFallback(audioAsset: Asset): Howl {
		audioHowl = new Howl({
			mute: globalState.getVideoPreviewState.showVideosAndAudios,
			src: [`${convertFileSrc(audioAsset.filePath)}?v=${audioAsset.mediaReloadToken}`],
			html5: !isLinux,
			rate: audioSpeed,
			onplay: () => {
				void audioBoostContext?.resume();
				seekAudio(getCurrentAudioTimeToPlay());
				if (!audioUpdateInterval) {
					audioUpdateInterval = setInterval(handleAudioTimeUpdate, 10);
				}
			},
			onloaderror: (_id, error) => {
				console.error('Howler load error:', error);
				if (error === 'No codec support for selected audio sources.') {
					toast.error(get(LL).editor.convertToMp4Error());
					return;
				}
				if (isLinux && error === 'Decoding audio data failed.') return;
				if (Date.now() - lastTimeErrorShown > 5000) {
					if (error === 4) {
						toast.error(get(LL).editor.audioFileMissing(), { duration: 1000 });
					} else {
						toast.error(get(LL).editor.unknownAudioError({ error: JSON.stringify(error) }), {
							duration: 1000
						});
					}
					lastTimeErrorShown = Date.now();
				}
			},
			onplayerror: (_id, error) => {
				console.error('Howler play error:', error);
				if (isPlaybackUnlockError(error)) {
					audioHowl?.once('unlock', () => {
						if (isPlaying && audioHowl && !audioHowl.playing()) audioHowl.play();
					});
					return;
				}
				toast.error(get(LL).editor.audioFailedToPlay({ error: JSON.stringify(error) }));
				pause();
			},
			onpause: () => {
				if (audioUpdateInterval) {
					clearInterval(audioUpdateInterval);
					audioUpdateInterval = null;
				}
			},
			onend: () => {
				if (audioUpdateInterval) {
					clearInterval(audioUpdateInterval);
					audioUpdateInterval = null;
				}
				goNextAudio();
			}
		});
		applyAudioVolume(globalState.getAudioTrack.volumePercent);
		return audioHowl;
	}

	/**
	 * Prépare l'asset courant dans le lecteur natif sans le recharger lors d'un seek.
	 * @returns {Promise<void>} Promesse résolue après le chargement natif ou du fallback.
	 */
	async function setupAudio(): Promise<void> {
		const setupId = ++nativeAudioSetupId;
		const audioAsset = currentAudio();
		nativeAudioSeekId++;
		nativeAudioReady = false;
		stopNativeAudioClock();
		if (audioHowl) {
			audioHowl.unload();
			audioHowl = null;
		}
		if (audioUpdateInterval) {
			clearInterval(audioUpdateInterval);
			audioUpdateInterval = null;
		}

		if (!audioAsset) {
			try {
				await controlNativeAudio('unload');
			} catch (error) {
				console.error('Native audio unload error:', error);
			}
			return;
		}

		try {
			const currentAudioClip = globalState.getAudioTrack.getCurrentClip();
			nativeAudioClipStartTime = currentAudioClip?.startTime ?? 0;
			const status = await controlNativeAudio('load', {
				filePath: audioAsset.filePath,
				volume: getNativeAudioVolume(globalState.getAudioTrack.volumePercent),
				speed: audioSpeed
			});
			if (setupId !== nativeAudioSetupId) return;
			nativeAudioReady = true;
			applyNativeAudioStatus(status);
			if (isPlaying) {
				await playNativeAudioAtCursor();
			} else {
				await seekNativeAudioToCursor(false);
			}
		} catch (error) {
			if (setupId !== nativeAudioSetupId) return;
			await activateHowlerFallback(error);
		}
	}

	// === CONTRÔLES DE LECTURE ===

	/**
	 * Joue l'audio silencieux quand aucun média n'est disponible
	 * Simule la présence d'un asset et clip pour le bon fonctionnement
	 */
	function playSilentAudio() {
		loadedAudioKey = undefined;
		if (nativeAudioReady) {
			nativeAudioSetupId++;
			nativeAudioReady = false;
			stopNativeAudioClock();
			void controlNativeAudio('unload').catch((error) =>
				console.error('Native audio unload error:', error)
			);
		}
		// Nettoie l'instance audio précédente
		if (audioHowl) {
			audioHowl.unload();
			audioHowl = null;
		}

		// Crée une nouvelle instance Howl pour silent.ogg
		audioHowl = new Howl({
			src: ['/silent.ogg'], // Chemin vers le fichier silent.ogg dans static/
			html5: !isLinux,
			loop: true, // Répète en boucle pour simuler une lecture continue
			volume: 0, // Volume à 0 pour être réellement silencieux
			onplay: () => {
				// Protection: si l'utilisateur a déjà mis pause avant que Howl
				// ait fini de charger, on ne démarre pas la lecture.
				if (!isPlaying) {
					audioHowl?.pause();
					return;
				}

				// Démarre la mise à jour du curseur
				if (!audioUpdateInterval) {
					audioUpdateInterval = setInterval(() => {
						// Avance le curseur manuellement de 10ms à chaque intervalle
						if (isPlaying) {
							getTimelineSettings().cursorPosition += 10;
						}
					}, 10);
				}
			},
			onpause: () => {
				// Arrête la mise à jour du curseur
				if (audioUpdateInterval) {
					clearInterval(audioUpdateInterval);
					audioUpdateInterval = null;
				}
			}
		});

		audioHowl.play();
	}

	/**
	 * Lance la lecture audio et vidéo
	 * @param fromButton - Indique si l'action vient du bouton play (pour afficher un toast si nécessaire)
	 */
	function play(_fromButton: boolean = false) {
		// Vérification de la présence de médias
		if (!currentVideo() && !currentAudio()) {
			// Si aucun média, joue silent.ogg pour simuler une lecture
			isPlaying = true;
			globalState.getVideoPreviewState.isPlaying = true;
			playSilentAudio();
			return;
		}

		if (!currentAudio() && isVideoLooping()) {
			playSilentAudio();
		}

		isPlaying = true;
		globalState.getVideoPreviewState.isPlaying = true;

		// Lance la lecture audio et vidéo simultanément
		if (nativeAudioReady && currentAudio()) {
			void playNativeAudioAtCursor();
		} else if (audioHowl) {
			audioHowl.play();
		}
		if (videoElement) {
			videoElement.play();
		}
	}

	/**
	 * Met en pause la lecture audio et vidéo
	 */
	function pause() {
		isPlaying = false;
		globalState.getVideoPreviewState.isPlaying = false;
		stopTransitionAnimationClock();
		stopNativeAudioClock();

		// Pause audio et vidéo
		if (nativeAudioReady) {
			void pauseNativeAudio();
		} else if (audioHowl) {
			audioHowl.pause();

			// Si c'est un audio silencieux (pas de média réel), on le décharge complètement
			if (!currentVideo() && !currentAudio()) {
				audioHowl.unload();
				audioHowl = null;
			}
		}
		if (videoElement) {
			videoElement.pause();
		}

		// Prépare la synchronisation pour la prochaine lecture

		// Arrête la mise à jour du curseur audio AVANT de set le movePreviewTo
		if (audioUpdateInterval) {
			clearInterval(audioUpdateInterval);
			audioUpdateInterval = null;
		}

		getTimelineSettings().movePreviewTo = getTimelineSettings().cursorPosition;
	}

	/**
	 * Navigue vers une position spécifique dans l'audio
	 * @param val - Position en secondes
	 */
	function seekAudio(val: number) {
		if (audioHowl) {
			audioHowl.seek(val);
		}
	}

	/**
	 * Détecte les erreurs de lecture liées au verrouillage autoplay du navigateur.
	 */
	function isPlaybackUnlockError(error: unknown): boolean {
		if (typeof error !== 'string') return false;

		const normalizedError = error.toLowerCase();
		return (
			normalizedError.includes('playback was unable to start') ||
			normalizedError.includes('notallowederror') ||
			normalizedError.includes('user interaction')
		);
	}

	/**
	 * Synchronise les médias avec le curseur sans redémarrer inutilement
	 * la lecture quand un simple seek suffit.
	 */
	function syncMediaToCursorPosition() {
		const shouldKeepPlaying = isPlaying;
		const video = currentVideo();
		const audio = currentAudio();

		if (videoElement && video) {
			videoElement.currentTime = getCurrentVideoTimeToPlay();

			if (shouldKeepPlaying && videoElement.paused) {
				void videoElement.play().catch(() => {
					// Vidéo muette: ignorer un blocage ponctuel n'affecte pas l'audio.
				});
			}
		}

		if (nativeAudioReady && audio) {
			void seekNativeAudioToCursor(shouldKeepPlaying);
		} else if (audioHowl && audio) {
			if (audioUpdateInterval) {
				clearInterval(audioUpdateInterval);
				audioUpdateInterval = null;
			}
			audioHowl.unload();
			const fallbackAudio = setupHowlerFallback(audio);
			if (shouldKeepPlaying) fallbackAudio.play();
		}
	}

	// === NAVIGATION ENTRE MÉDIAS ===
	/**
	 * Passe au prochain média quand une vidéo se termine
	 */
	function goNextVideo() {
		const currentTime = getTimelineSettings().cursorPosition;
		const videoTrack = globalState.getVideoTrack;

		// Cherche la prochaine vidéo uniquement
		if (videoTrack) {
			const nextVideoClip = videoTrack.clips.find((clip) => clip.startTime > currentTime - 1000);
			if (nextVideoClip) {
				// Avance le curseur au début de la prochaine vidéo
				getTimelineSettings().cursorPosition = nextVideoClip.startTime;
				triggerVideoAndAudioToFitCursor();
			}
			// Si aucune prochaine vidéo, ne fait rien (continue avec fond noir)
		}
	}

	/**
	 * Passe au prochain média quand un audio se termine
	 */
	function goNextAudio() {
		goToNextMedia(false, true);
	}

	/**
	 * Trouve et navigue vers le prochain média dans la timeline
	 * @param video - Inclure les pistes vidéo dans la recherche
	 * @param audio - Inclure les pistes audio dans la recherche
	 */
	function goToNextMedia(video: boolean = true, audio: boolean = true) {
		const currentTime = getTimelineSettings().cursorPosition;

		// Récupération des pistes vidéo et audio
		const videoTrack = globalState.getVideoTrack;
		const audioTrack = globalState.getAudioTrack;

		const nextClips: { clip: { startTime: number }; startTime: number }[] = [];

		// Recherche du prochain clip vidéo
		if (videoTrack && video) {
			const nextVideoClip = videoTrack.clips.find((clip) => clip.startTime > currentTime - 1000);
			if (nextVideoClip) {
				nextClips.push({ clip: nextVideoClip, startTime: nextVideoClip.startTime });
			}
		}

		// Recherche du prochain clip audio
		if (audioTrack && audio) {
			const nextAudioClip = audioTrack.clips.find((clip) => clip.startTime > currentTime - 1000);
			if (nextAudioClip) {
				nextClips.push({ clip: nextAudioClip, startTime: nextAudioClip.startTime });
			}
		}
		if (nextClips.length > 0) {
			// Trouve le clip qui commence le plus tôt
			const earliestClip = nextClips.reduce((earliest, current) =>
				current.startTime < earliest.startTime ? current : earliest
			);

			// Avance le curseur au début du prochain clip
			getTimelineSettings().cursorPosition = earliestClip.startTime;
			triggerVideoAndAudioToFitCursor();
		} else if (audio && !video) {
			// Seulement si on cherche de l'audio ET qu'on n'en trouve pas, joue silent
			playSilentAudio();
		}
		// Sinon ne fait rien (cas vidéo qui se termine sans prochaine vidéo)
	}

	onMount(() => {
		// Si Quran Caption a été quitté en fullscreen, on enlève le fullscreen.
		if (globalState.getVideoPreviewState.isFullscreen) {
			globalState.getVideoPreviewState.toggleFullScreen();
		}

		globalState.getVideoPreviewState.togglePlayPause = togglePlayPause;
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && globalState.getVideoPreviewState.isFullscreen) {
			globalState.getVideoPreviewState.toggleFullScreen();
		}
	}}
/>

<section
	class="overflow-hidden min-h-0"
	id="video-preview-section"
	style={showControls
		? `height: ${globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight}%;`
		: ''}
>
	<div
		class="w-full h-full flex flex-col relative overflow-hidden background-primary"
		id="preview-container"
	>
		<!-- Conteneur de la prévisualisation vidéo avec mise à l'échelle -->
		<div class="relative origin-top-left overflow-hidden bg-black" id="preview">
			{#if showAntiCollisionNotice}
				<div
					class="absolute left-6 top-6 z-30 flex max-w-[calc(100%_-_3rem)] items-center gap-4 rounded-lg border border-amber-500/45 bg-slate-900/85 px-5 py-3 text-[28px] leading-tight text-white/90 shadow-md backdrop-blur-sm"
				>
					<span class="material-icons-outlined text-4xl text-amber-500" aria-hidden="true">
						warning_amber
					</span>
					<span>{antiCollisionNoticeCopy.antiCollisionNotice()}</span>
					<span class="group relative">
						<button
							type="button"
							class="flex h-10 w-10 items-center justify-center rounded-full text-[28px] text-white/70 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white border-2 border-amber-500/70"
							aria-label={get(LL).common.question()}
							aria-describedby="anti-collision-notice-tooltip"
						>
							?
						</button>
						<span
							id="anti-collision-notice-tooltip"
							class="absolute left-[-16px] top-[calc(100%+16px)] hidden w-[min(840px,80vw)] rounded-lg border border-white/15 bg-slate-900/95 px-6 py-5 text-[26px] leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block"
							role="tooltip"
						>
							<span class="font-mono font-semibold text-amber-300">{$LL.status.video()}</span>
							→
							<span class="font-mono font-semibold text-amber-300">
								{getStyleName('general', $LL)}
							</span>
							→
							<span class="font-mono font-semibold text-amber-300">
								{getStyleName('anti-collision', $LL)}
							</span>
							{' '}
							{antiCollisionNoticeCopy.antiCollisionNoticeHelpEnabled()}
							<br /><br />
							{antiCollisionNoticeCopy.antiCollisionNoticeHelpAlternative()}
							{' '}
							<span class="font-mono font-semibold text-amber-300">
								{getStyleName('max-height', $LL)}
							</span>
							{' '}
							{antiCollisionNoticeCopy.antiCollisionNoticeHelpAnd()}
							{' '}
							<span class="font-mono font-semibold text-amber-300">
								{getStyleName('vertical-text-alignment', $LL)}
							</span>
							{' '}
							{antiCollisionNoticeCopy.antiCollisionNoticeHelpTargets()}
						</span>
					</span>
					<button
						type="button"
						class="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:text-white"
						onclick={dismissAntiCollisionNotice}
						aria-label={get(LL).common.dismiss()}
						title={get(LL).common.dismiss()}
					>
						<span class="material-icons-outlined text-3xl" aria-hidden="true">close</span>
					</button>
				</div>
			{/if}
			{#if !globalState.getVideoPreviewState.showVideosAndAudios}
				{#if currentVideo()}
					{@const transitionState = videoClipTransitionState()}
					<video
						bind:this={videoElement}
						src={`${convertFileSrc(currentVideo()!.filePath)}?v=${currentVideo()!.mediaReloadToken}`}
						muted
						loop={isVideoLooping()}
						onended={goNextVideo}
						style={`${backgroundMediaStyle} opacity: ${transitionState.currentOpacity};`}
					></video>
					{#if transitionState.showCrossfadeNotice}
						<div class="crossfade-preview-notice">{getCrossfadePreviewNotice()}</div>
					{/if}
				{:else if currentImage()}
					<img
						src={`${convertFileSrc(currentImage()!.filePath)}?v=${currentImage()!.mediaReloadToken}`}
						style={backgroundMediaStyle}
						alt=""
					/>
				{/if}
			{/if}

			<!-- Contient l'affichage des sous-titres et de tout les autres style -->
			<VideoOverlay />
		</div>
	</div>
</section>

{#if showControls}
	<VideoPreviewControlsBar {togglePlayPause} />
{/if}

<style>
	/* Styles pour assurer un dimensionnement correct */
	#preview-container {
		height: 100%;
		min-height: 0;
	}
	#preview {
		height: 100%;
		min-height: 0;
	}
	video {
		height: 100% !important;
		width: 100% !important;
		min-height: 0 !important;
		display: block;
	}
	.crossfade-preview-notice {
		position: absolute;
		left: 50%;
		bottom: 18px;
		z-index: 20;
		max-width: min(90%, 720px);
		transform: translateX(-50%);
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.82);
		color: #ffffff;
		padding: 7px 12px;
		text-align: center;
		font-size: 20px;
		line-height: 1.35;
	}
</style>
