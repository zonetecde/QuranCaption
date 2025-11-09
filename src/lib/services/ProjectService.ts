import { Project, ProjectContent, ProjectDetail, Utilities, VideoStyle } from '$lib/classes';
import { readDir, remove, writeTextFile, readTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Service pour gérer les projets.
 * Utilise JSONProjectStorage pour la persistance des données.
 */
export class ProjectService {
	private static projectsFolder: string = 'projects/';
	private static assetsFolder: string = 'assets/';

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
	static async saveDetail(detail: ProjectDetail): Promise<void> {
		// Récupère le projet complet
		const project = await this.load(detail.id);

		// Met à jour les détails du projet
		project.detail = detail;

		// Sauvegarde le projet complet
		await project.save();
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
			return new Project(ProjectDetail.fromJSON(projectData.detail));
		}

		// Utilise la méthode fromJSON automatique pour récupérer l'instance correcte
		const project = Project.fromJSON(projectData);

		// Si le projet ne contient pas de styles vidéo, on initialise avec un style par défaut
		// || true
		if (Object.keys(project.content.videoStyle.styles).length === 0) {
			// Si les styles ne sont pas définis, on initialise avec un style par défaut
			project.content.videoStyle = await VideoStyle.getDefaultVideoStyle();
		} else {
			await project.content.videoStyle.loadAllCompositeStyles();
		}

		return project;
	}

	/**
	 * Charge uniquement les détails d'un projet.
	 * @param projectId L'id du projet
	 * @returns Les détails du projet
	 */
	static async loadDetail(projectId: number): Promise<ProjectDetail> {
		return (await this.load(projectId, true)).detail;
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
		} catch (e) {
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
			const projects: ProjectDetail[] = [];

			// Parcoure chaque fichier .json et charge le projet
			for (const entry of entries) {
				if (entry.isFile && entry.name.endsWith('.json')) {
					// Extraction de l'ID du nom de fichier (ex: "123.json" -> 123)
					const projectId = parseInt(entry.name.replace('.json', ''));

					if (!isNaN(projectId)) {
						try {
							// Charger le projet depuis le stockage
							// et récupérer les détails du projet
							projects.push(await this.loadDetail(projectId));
						} catch (error) {
							console.warn(`Impossible de charger le projet ${projectId}:`, error);
						}
					}
				}
			}

			// Trie les projets par date de création décroissante
			projects.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

			globalState.userProjectsDetails = projects;
		} catch (error) {
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
	 * Importe un projet à partir d'un fichier JSON.
	 * @param json Le contenu JSON du projet
	 */
	static importProject(json: any) {
		json.detail.id = Utilities.randomId(); // Applique un nouvel ID unique au projet

		const projectObject = Project.fromJSON(json);
		projectObject.save(); // Enregistre le projet importé sur le disque
	}
}
