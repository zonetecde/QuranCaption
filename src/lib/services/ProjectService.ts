import { Project, ProjectDetail, Utilities, VideoStyle } from '$lib/classes';
import { readDir, remove, writeTextFile, readTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import type { ImportedProjectPayload } from '$lib/types/project';

/**
 * Service pour gérer les projets.
 * Utilise JSONProjectStorage pour la persistance des données.
 */
export class ProjectService {
	private static projectsFolder: string = 'projects/';
	private static assetsFolder: string = 'assets/';
	private static detailsLoadConcurrency = 16;

	private static async mapWithConcurrency<T, R>(
		items: T[],
		concurrency: number,
		mapper: (item: T, index: number) => Promise<R>
	): Promise<R[]> {
		if (items.length === 0) return [];

		// Préserve l'ordre final des résultats même si le traitement est parallèle.
		const results: R[] = new Array(items.length);
		let cursor = 0;
		const workerCount = Math.min(concurrency, items.length);

		// Pool de workers asynchrones avec concurrence bornée.
		const workers = Array.from({ length: workerCount }, async () => {
			while (true) {
				const index = cursor++;
				if (index >= items.length) break;
				results[index] = await mapper(items[index], index);
			}
		});

		await Promise.all(workers);
		return results;
	}

	/**
	 * Lit les détails d'un projet à partir d'un fichier.
	 * @param projectsPath Le chemin vers le dossier des projets
	 * @param fileName Le nom du fichier à lire
	 * @returns Les détails du projet ou null si le fichier n'existe pas
	 */
	private static async readProjectDetailFromFile(
		projectsPath: string,
		fileName: string
	): Promise<ProjectDetail | null> {
		// Extraction de l'ID du nom de fichier (ex: "123.json" -> 123)
		const projectId = parseInt(fileName.replace('.json', ''), 10);
		if (isNaN(projectId)) return null;

		try {
			const filePath = await join(projectsPath, fileName);
			const fileContent = await readTextFile(filePath);
			const projectData = JSON.parse(fileContent);
			if (!projectData?.detail) {
				throw new Error('Missing detail object in project file');
			}
			// Charge uniquement les détails du projet pour accélérer la homepage.
			return ProjectDetail.fromJSON(projectData.detail) as ProjectDetail;
		} catch (error) {
			console.warn(`Impossible de charger le projet ${projectId}:`, error);
			return null;
		}
	}

	/**
	 * S'assure que le dossier des projets existe
	 */
	static async ensureFolder(folder: string): Promise<string> {
		const folderPath = await join(await appDataDir(), folder);
		if (!(await exists(folderPath))) {
			await mkdir(folderPath, { recursive: true });
		}
		return folderPath;
	}

	static async getProjectsFolderPath(): Promise<string> {
		return this.ensureFolder(this.projectsFolder);
	}

	/**
	 * Sauvegarde un projet sur l'ordinateur
	 * @param project Le projet à sauver
	 */
	static async save(project: Project) {
		// S'assure que le dossier existe
		const projectsPath = await this.ensureFolder(this.projectsFolder);

		// Construis le chemin d'accès vers le projet
		const filePath = await join(projectsPath, `${project.detail.id}.json`);

		await writeTextFile(filePath, JSON.stringify(project.toJSON(), null, 2));
	}

	/**
	 * Sauvegarde les détails d'un projet.
	 * @param detail Les détails du projet à sauvegarder
	 */
	static async saveDetail(detail: ProjectDetail, updateUpdateAt: boolean = true): Promise<void> {
		// Récupère le projet complet
		const project = await this.load(detail.id);

		// Met à jour les détails du projet
		project.detail = detail;

		// Sauvegarde le projet complet
		await project.save(updateUpdateAt);
	}

	/**
	 * Charge un projet complet depuis le stockage.
	 * @param projectId L'id du projet
	 * @param onlyDetail Si true, ne charge que les détails du projet
	 * @returns Le projet
	 */
	static async load(
		projectId: number,
		onlyDetail: boolean = false,
		customFolder?: string
	): Promise<Project> {
		const folder = customFolder || this.projectsFolder;

		// S'assure que le dossier existe
		const projectsPath = await this.ensureFolder(folder);

		// Construis le chemin d'accès vers le projet
		const filePath = await join(projectsPath, `${projectId}.json`);

		// Vérifie que le fichier existe
		if (!(await exists(filePath))) {
			throw new Error(`Project with ID ${projectId} not found.`);
		}

		// Lit le fichier JSON
		const fileContent = await readTextFile(filePath);
		const projectData = JSON.parse(fileContent);

		if (onlyDetail) {
			// Évite de charger le contenu du projet si on ne veut que les détails
			return new Project(ProjectDetail.fromJSON(projectData.detail) as ProjectDetail);
		}

		// Utilise la méthode fromJSON automatique pour récupérer l'instance correcte
		const project = Project.fromJSON(projectData) as Project;

		// Si le projet ne contient pas de styles vidéo, on initialise avec un style par défaut
		// || true
		if (Object.keys(project.content.videoStyle.styles).length === 0) {
			// Si les styles ne sont pas définis, on initialise avec un style par défaut
			project.content.videoStyle = await VideoStyle.getDefaultVideoStyle();
		}

		return project;
	}

	/**
	 * Supprime un projet de l'ordinateur.
	 * @param projectId L'id du projet à supprimer
	 */
	static async delete(projectId: number): Promise<void> {
		const projectsPath = await join(await appDataDir(), this.projectsFolder);

		try {
			// Construis le chemin d'accès vers le projet
			const filePath = await join(projectsPath, `${projectId}.json`);
			await remove(filePath);

			// Supprime le dossier des assets associés au projet
			const assetsPath = await this.getAssetFolderForProject(projectId);
			await remove(assetsPath, { recursive: true });
		} catch (_e) {
			// Le projet n'avait pas d'asset
		}

		// Le supprime de la liste des projets
		setTimeout(() => {
			globalState.userProjectsDetails = globalState.userProjectsDetails.filter(
				(p) => p.id !== projectId
			);
		}, 0);
	}

	/**
	 * Récupère tous les détails des projets existants.
	 * Met à jour la liste des projets de l'utilisateur dans le globalState.
	 */
	static async loadUserProjectsDetails() {
		try {
			// Récupère le chemin absolu vers le dossier contenant les projets
			const projectsPath = await join(await appDataDir(), this.projectsFolder);

			// Vérifie que le dossier existe
			if (!(await exists(projectsPath))) {
				// Si le dossier n'existe pas, c'est que l'utilisateur n'a
				// pas encore créer de projet
				return [];
			}

			// Récupère tout les fichiers projets
			const entries = await readDir(projectsPath);
			const projectFiles = entries
				// Conserve uniquement les fichiers JSON de projet.
				.filter((entry) => entry.isFile && !!entry.name && entry.name.endsWith('.json'))
				.map((entry) => entry.name as string);

			// Charge les détails en parallèle (au lieu d'un await séquentiel par fichier).
			const loaded = await this.mapWithConcurrency(
				projectFiles,
				this.detailsLoadConcurrency,
				(fileName) => this.readProjectDetailFromFile(projectsPath, fileName)
			);
			// Ignore les fichiers invalides/corrompus tout en gardant les projets valides.
			const projects = loaded.filter((project): project is ProjectDetail => project !== null);

			// Trie les projets par date de création décroissante
			projects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

			globalState.userProjectsDetails = projects;
		} catch (_error) {
			return [];
		}
	}

	/**
	 * Récupère le chemin du dossier des assets téléchargés.
	 * @returns Le chemin du dossier des assets
	 */
	static async getAssetFolderForProject(projectId: number): Promise<string> {
		return await join(await appDataDir(), this.assetsFolder, projectId.toString());
	}

	/**
	 * Duplicate a project completely (JSON files and asset folder) with a new ID.
	 * @param projectId The ID of the project to duplicate
	 * @returns The exact duplicated project instance
	 */
	static async duplicate(projectId: number): Promise<Project> {
		// Load the full project
		const project = await this.load(projectId);

		// Clone JSON
		const duplicatedJson = JSON.parse(JSON.stringify(project.toJSON()));

		// Set new identifiers and details
		const newId = Utilities.randomId();
		duplicatedJson.detail._id = undefined;
		duplicatedJson.detail.id = newId;
		duplicatedJson.detail.name = `${duplicatedJson.detail.name} (Copy)`.substring(
			0,
			ProjectDetail.NAME_MAX_LENGTH
		);
		duplicatedJson.detail.createdAt = new Date().toISOString();
		duplicatedJson.detail.updatedAt = new Date().toISOString();

		// Instantiate and save
		const duplicatedProject = Project.fromJSON(duplicatedJson) as Project;
		await this.save(duplicatedProject);

		// Copy assets directory if one exists
		try {
			const oldAssetDir = await this.getAssetFolderForProject(projectId);
			const newAssetDir = await this.getAssetFolderForProject(newId);
			if (await exists(oldAssetDir)) {
				await mkdir(newAssetDir, { recursive: true });
				const entries = await readDir(oldAssetDir);
				for (const entry of entries) {
					if (entry.isFile) {
						try {
							const { copyFile } = await import('@tauri-apps/plugin-fs');
							await copyFile(`${oldAssetDir}/${entry.name}`, `${newAssetDir}/${entry.name}`);
						} catch (e) {
							console.warn('Could not copy a specific project asset:', e);
						}
					}
				}
			}
		} catch (e) {
			console.warn('Could not fully copy project assets folder:', e);
		}

		return duplicatedProject;
	}

	/**
	 * Importe un projet à partir d'un fichier JSON.
	 * @param json Le contenu JSON du projet
	 */
	static async importProject(json: ImportedProjectPayload) {
		json.detail.id = Utilities.randomId(); // Applique un nouvel ID unique au projet

		const projectObject = Project.fromJSON(json) as Project;
		await projectObject.save(); // Enregistre le projet importé sur le disque
	}

	/**
	 * Import projects from a backup.
	 * @param projects The list of projects to import
	 * @returns An object containing the import results
	 */
	static async importProjectsBackup(projects: ImportedProjectPayload[]): Promise<{
		imported: number;
		skipped: number;
		invalid: number;
	}> {
		if (!Array.isArray(projects)) {
			throw new Error('Backup file must contain an array of projects.');
		}

		const projectsPath = await this.ensureFolder(this.projectsFolder);
		const existingEntries = await readDir(projectsPath);
		const existingIds = new Set<number>(
			existingEntries
				.filter((entry) => entry.isFile && !!entry.name && entry.name.endsWith('.json'))
				.map((entry) => Number.parseInt((entry.name as string).replace('.json', ''), 10))
				.filter((id) => Number.isFinite(id))
		);

		let imported = 0;
		let skipped = 0;
		let invalid = 0;
		const seenBackupIds = new Set<number>();

		for (const rawProject of projects) {
			const projectId = rawProject?.detail?.id;

			if (typeof projectId !== 'number' || !Number.isFinite(projectId)) {
				invalid++;
				continue;
			}

			if (existingIds.has(projectId) || seenBackupIds.has(projectId)) {
				skipped++;
				continue;
			}

			try {
				const projectObject = Project.fromJSON(rawProject) as Project;
				await this.save(projectObject);
				existingIds.add(projectId);
				seenBackupIds.add(projectId);
				imported++;
			} catch (error) {
				console.warn(`Failed to import backup project ${projectId}:`, error);
				invalid++;
			}
		}

		await this.loadUserProjectsDetails();

		return { imported, skipped, invalid };
	}
}
