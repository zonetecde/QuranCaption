import { mount, unmount } from 'svelte';
import Confirm from './Confirm.svelte';
import Input from './Input.svelte';
import Error from './Error.svelte';
import Settings from '../settings/Settings.svelte';
import NewUpdateModal from '../home/modals/NewUpdateModal.svelte';
import CreateStylePresetModal from '../home/modals/CreateStylePresetModal.svelte';
import ManageStylePresetsModal from '../home/modals/ManageStylePresetsModal.svelte';
import { type UpdateInfo } from '$lib/services/VersionService.svelte';
import type { StylePreset } from '$lib/classes/StylePreset.svelte';

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

	static async settingsModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			// Créer un conteneur pour le modal
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			// Monter le composant Svelte 5
			const confirm = mount(Settings, {
				target: container,
				props: {
					resolve: () => {
						// Nettoyer et résoudre
						unmount(confirm);
						document.body.removeChild(container);
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
						document.body.removeChild(container);
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
					}
				}
			});
		});
	}

	static async createStylePresetModal(): Promise<StylePreset | null> {
		return new Promise<StylePreset | null>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(CreateStylePresetModal, {
				target: container,
				props: {
					resolve: (result: StylePreset | null) => {
						unmount(modal);
						document.body.removeChild(container);
						resolve(result);
					}
				}
			});
		});
	}

	static async manageStylePresetsModal(): Promise<void> {
		return new Promise<void>((resolve) => {
			const container = document.createElement('div');
			container.classList.add('modal-wrapper');
			document.body.appendChild(container);

			const modal = mount(ManageStylePresetsModal, {
				target: container,
				props: {
					resolve: () => {
						unmount(modal);
						document.body.removeChild(container);
						resolve();
					}
				}
			});
		});
	}
}
