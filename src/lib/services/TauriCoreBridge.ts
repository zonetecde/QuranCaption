import {
	addPluginListener,
	Channel,
	checkPermissions,
	convertFileSrc,
	invoke as nativeInvoke,
	isTauri,
	PluginListener,
	requestPermissions,
	Resource,
	SERIALIZE_TO_IPC_FN,
	transformCallback,
	type InvokeArgs,
	type InvokeOptions,
	type PermissionState
} from '../../../node_modules/@tauri-apps/api/core.js';

type InvokeBridgeWindow = Window & {
	__QURAN_CAPTION_INVOKE_BRIDGE__?: (
		command: string,
		args?: InvokeArgs,
		options?: InvokeOptions
	) => Promise<unknown>;
};

/**
 * Exécute une commande Tauri directement dans la fenêtre principale ou via son pont dans l'iframe.
 *
 * @param command - Nom de la commande Tauri à exécuter.
 * @param args - Arguments optionnels de la commande.
 * @param options - Options optionnelles de l'appel IPC.
 * @returns Le résultat typé de la commande.
 */
export function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
	if (typeof window !== 'undefined' && window.parent !== window) {
		const bridge = (window as InvokeBridgeWindow).__QURAN_CAPTION_INVOKE_BRIDGE__;

		if (!bridge) {
			return Promise.reject(new Error('ANDROID_EXPORT_INVOKE_BRIDGE_MISSING'));
		}

		return bridge(command, args, options) as Promise<T>;
	}

	return nativeInvoke<T>(command, args, options);
}

export type { InvokeArgs, InvokeOptions, PermissionState };
export {
	addPluginListener,
	Channel,
	checkPermissions,
	convertFileSrc,
	isTauri,
	PluginListener,
	requestPermissions,
	Resource,
	SERIALIZE_TO_IPC_FN,
	transformCallback
};
