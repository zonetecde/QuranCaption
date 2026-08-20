import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import Confirm from './Confirm.svelte';
import Input from './Input.svelte';
import Error from './Error.svelte';
import NewUpdateModal from '../home/modals/NewUpdateModal.svelte';
import DeleteConfirmation from './DeleteConfirmation.svelte';
import ShiftSubtitlesModal from './tools/ShiftSubtitlesModal.svelte';
import HifzRepetitionModal from './tools/HifzRepetitionModal.svelte';
import AudioCutterModal from './tools/AudioCutterModal.svelte';
import VerseRangeCropModal from './tools/VerseRangeCropModal.svelte';
import BookmarkVerseModal from './BookmarkVerseModal.svelte';
import QuickTimelineEditorModal from './QuickTimelineEditorModal.svelte';
import AiBoldModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AiBoldModal.svelte';
import AiWbwTranslationModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AiWbwTranslationModal.svelte';
import AiTranslationReviewModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AiTranslationReviewModal.svelte';
import AiSubtitleSplitModal from '$lib/components/projectEditor/tabs/subtitlesEditor/AiSubtitleSplitModal.svelte';
import AskIAModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AskIAModal.svelte';
import type { Edition } from '$lib/classes';
import type { UpdateInfo } from '$lib/services/VersionService.svelte';
import LL from '$lib/i18n/i18n-svelte';

export default class ModalManager {
	static async confirmModal(text: string, yesNo: boolean = false): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			// Créer un conteneur pour le modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			// Monter le composant Svelte 5
			const confirm = mount(Confirm, {
				target: container,
				props: {
					text: text,
					yesNo: yesNo,
					resolve: (result: boolean) => {
						// Nettoyer et résoudre
						unmount(confirm);
						container.remove();
						resolve(result);
					}
				}
			});
		});
	}

	static async deleteConfirmationModal(
		text: string,
		allowDeleteFromDisk: boolean = true
	): Promise<{ confirmed: boolean; deleteFile: boolean }> {
		return new Promise<{ confirmed: boolean; deleteFile: boolean }>((resolve) => {
			// Créer un conteneur pour le modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			// Monter le composant Svelte 5
			const confirm = mount(DeleteConfirmation, {
				target: container,
				props: {
					text: text,
					allowDeleteFromDisk: allowDeleteFromDisk,
					resolve: (result: { confirmed: boolean; deleteFile: boolean }) => {
						// Nettoyer et résoudre
						unmount(confirm);
						container.remove();
						resolve(result);
					}
				}
			});
		});
	}

	static async settingsModal(): Promise<void> {
		const { globalState } = await import('$lib/runes/main.svelte');
		globalState.uiState.isSettingsOpen = !globalState.uiState.isSettingsOpen;
	}

	/**
	 * Ouvre la modale présentant une nouvelle version Android.
	 *
	 * @param {UpdateInfo} update Informations de la release disponible.
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async newUpdateModal(update: UpdateInfo): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(NewUpdateModal, {
				target: container,
				props: {
					update,
					resolve: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	static async errorModal(title: string, message: string, logs?: string): Promise<void> {
		return new Promise<void>((resolve) => {
			// Créer un conteneur pour le modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);
			// Monter le composant Svelte 5
			const confirm = mount(Error, {
				target: container,
				props: {
					title: title,
					message: message,
					logs: logs,
					resolve: () => {
						// Nettoyer et résoudre
						unmount(confirm);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	static async inputModal(
		text: string,
		defaultText: string = '',
		maxlength: number = 100,
		placeholder: string = get(LL).common.enterTextHere(),
		inputType: 'text' | 'reciters' = 'text'
	): Promise<string> {
		return new Promise<string>((resolve) => {
			// Créer un conteneur pour le modal
			const container = document.createElement('div');
			container.className = 'modal-wrapper';
			document.body.appendChild(container);

			// Monter le composant Svelte 5
			const input = mount(Input, {
				target: container,
				props: {
					text: text,
					defaultText: defaultText,
					maxlength: maxlength,
					placeholder: placeholder,
					inputType: inputType,
					resolve: (result: string) => {
						// Nettoyer et résoudre
						unmount(input);
						container.remove();
						resolve(result);
					}
				}
			});
		});
	}

	static async shiftSubtitlesModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			// Create a container for the modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			// Mount the Svelte component
			const modal = mount(ShiftSubtitlesModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale du tool de répétition Hifz.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async hifzRepetitionModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			// Crée un conteneur pour la modale du tool Hifz.
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(HifzRepetitionModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale de rognage du projet à une plage d'Ayahs.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async verseRangeCropModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(VerseRangeCropModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	static async audioCutterModal(initialAssetId?: number): Promise<void> {
		return new Promise<void>((resolve) => {
			// Create a container for the modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			// Mount the Svelte component
			const modal = mount(AudioCutterModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					},
					initialAssetId
				}
			});
		});
	}

	static async bookmarkVerseModal(surah: number, verse: number): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(BookmarkVerseModal, {
				target: container,
				props: {
					surah,
					verse,
					resolve: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale AI Bold au niveau de la page.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async aiBoldModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(AiBoldModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale de découpage sémantique des sous-titres.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async aiSubtitleSplitModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(AiSubtitleSplitModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale AI WBW translation au niveau de la page.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async aiWbwTranslationModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(AiWbwTranslationModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale de vérification IA de toutes les traductions du projet.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async aiTranslationReviewModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(AiTranslationReviewModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale de traduction IA au niveau de la page.
	 * @param {Edition} edition Édition de traduction à traiter.
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async askTranslationModal(edition: Edition): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(AskIAModal, {
				target: container,
				props: {
					edition,
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}

	/**
	 * Ouvre la modale d'édition rapide de sous-titre en feuille du bas.
	 *
	 * @returns {Promise<void>} Résolution après fermeture de la modale.
	 */
	static async quickTimelineEditorModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(QuickTimelineEditorModal, {
				target: container,
				props: {
					close: () => {
						unmount(modal);
						container.remove();
						resolve();
					}
				}
			});
		});
	}
}
