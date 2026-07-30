import {
	appCacheDir,
	appConfigDir,
	appLocalDataDir,
	appLogDir,
	audioDir,
	BaseDirectory,
	cacheDir,
	configDir,
	dataDir,
	delimiter,
	desktopDir,
	dirname,
	documentDir,
	downloadDir,
	executableDir,
	fontDir,
	homeDir,
	isAbsolute,
	normalize,
	pictureDir,
	publicDir,
	resolve,
	resourceDir,
	runtimeDir,
	sep,
	tempDir,
	templateDir,
	videoDir
} from '../../../node_modules/@tauri-apps/api/path.js';
import { invoke } from './TauriCoreBridge';

/**
 * Résout un chemin depuis un répertoire système Tauri.
 *
 * @param directory - Répertoire système à résoudre.
 * @param path - Chemin relatif optionnel dans ce répertoire.
 * @returns Le chemin absolu résolu.
 */
function resolveDirectory(directory: BaseDirectory, path?: string): Promise<string> {
	return invoke<string>('plugin:path|resolve_directory', { directory, path });
}

/**
 * Retourne le répertoire de données de l'application.
 *
 * @returns Le chemin absolu du répertoire.
 */
export function appDataDir(): Promise<string> {
	return resolveDirectory(BaseDirectory.AppData);
}

/**
 * Retourne le répertoire local de données de l'application.
 *
 * @returns Le chemin absolu du répertoire.
 */
export function localDataDir(): Promise<string> {
	return resolveDirectory(BaseDirectory.LocalData);
}

/**
 * Résout un chemin relatif aux ressources intégrées.
 *
 * @param resourcePath - Chemin relatif de la ressource.
 * @returns Le chemin absolu de la ressource.
 */
export function resolveResource(resourcePath: string): Promise<string> {
	return resolveDirectory(BaseDirectory.Resource, resourcePath);
}

/**
 * Assemble plusieurs segments de chemin.
 *
 * @param paths - Segments de chemin à assembler.
 * @returns Le chemin assemblé.
 */
export function join(...paths: string[]): Promise<string> {
	return invoke<string>('plugin:path|join', { paths });
}

/**
 * Retourne l'extension d'un chemin.
 *
 * @param path - Chemin à analyser.
 * @returns L'extension du chemin.
 */
export function extname(path: string): Promise<string> {
	return invoke<string>('plugin:path|extname', { path });
}

/**
 * Retourne le dernier composant d'un chemin.
 *
 * @param path - Chemin à analyser.
 * @param ext - Extension optionnelle à retirer.
 * @returns Le nom de base du chemin.
 */
export function basename(path: string, ext?: string): Promise<string> {
	return invoke<string>('plugin:path|basename', { path, ext });
}

export {
	appCacheDir,
	appConfigDir,
	appLocalDataDir,
	appLogDir,
	audioDir,
	BaseDirectory,
	cacheDir,
	configDir,
	dataDir,
	delimiter,
	desktopDir,
	dirname,
	documentDir,
	downloadDir,
	executableDir,
	fontDir,
	homeDir,
	isAbsolute,
	normalize,
	pictureDir,
	publicDir,
	resolve,
	resourceDir,
	runtimeDir,
	sep,
	tempDir,
	templateDir,
	videoDir
};
