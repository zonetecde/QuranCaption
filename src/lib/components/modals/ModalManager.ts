import { mount, unmount } from 'svelte';
import Confirm from './Confirm.svelte';
import Input from './Input.svelte';
import Error from './Error.svelte';
import Settings from '../settings/Settings.svelte';
import NewUpdateModal from '../home/modals/NewUpdateModal.svelte';
import DeleteConfirmation from './DeleteConfirmation.svelte';
import ShiftSubtitlesModal from './tools/ShiftSubtitlesModal.svelte';
import AudioCutterModal from './tools/AudioCutterModal.svelte';
import { type UpdateInfo } from '$lib/services/VersionService.svelte';

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
						document.body.removeChild(container);
						resolve(result);
					}
				}
			});
		});
	}

	static async deleteConfirmationModal(
		text: string
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
					resolve: (result: { confirmed: boolean; deleteFile: boolean }) => {
						// Nettoyer et résoudre
						unmount(confirm);
						document.body.removeChild(container);
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
						document.body.removeChild(container);
						resolve();
					},
				}
			});
		});
	}

	static async inputModal(
		text: string,
		defaultText: string = '',
		maxlength: number = 100,
		placeholder: string = 'Enter text here',
		inputType: 'text' | 'reciters' = 'text'
	): Promise<string> {
		return new Promise<string>((resolve) => {
			// Supprime l'ancien modal s'il existe
			const existingModal = document.querySelector('.modal-wrapper');
			if (existingModal) {
				document.body.removeChild(existingModal);
			}

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
						document.body.removeChild(container);
						resolve(result);
					}
				}
			});
		});
	}

	static async newUpdateModal(update: UpdateInfo): Promise<void> {
		return new Promise<void>((resolve) => {
			// Créer un conteneur pour le modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			// Monter le composant Svelte 5
			const confirm = mount(NewUpdateModal, {
				target: container,
				props: {
					update: update,
					resolve: () => {
						// Nettoyer et résoudre
						unmount(confirm);
						document.body.removeChild(container);
						resolve();
					},
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
						document.body.removeChild(container);
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
						document.body.removeChild(container);
						resolve();
					},
					initialAssetId
				}
			});
		});
	}
}
