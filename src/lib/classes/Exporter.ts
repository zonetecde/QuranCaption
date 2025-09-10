import { globalState } from '$lib/runes/main.svelte';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor } from '@tauri-apps/api/window';
import { PredefinedSubtitleClip, SubtitleClip } from './Clip.svelte';
import SubtitleFileContentGenerator from './misc/SubtitleFileContentGenerator';
import { Quran } from './Quran';
import { Utilities } from './misc/Utilities';
import type { Project } from '.';
import ExportService from '$lib/services/ExportService';
import { BaseDirectory, join } from '@tauri-apps/api/path';
import { remove } from '@tauri-apps/plugin-fs';

export default class Exporter {
	/**
	 * Exporte le projet sous forme de sous-titres
	 */
	static exportSubtitles() {
		const es = globalState.getExportState;

		const settings = {
			format: es.subtitleFormat,
			includedTargets: Object.entries(es.includedTarget)
				.filter(([, included]) => included)
				.map(([target]) => target),
			exportVerseNumbers: es.exportVerseNumbers
		};

		let subtitles: {
			startTimeMs: number;
			endTimeMs: number;
			text: string;
		}[] = [];

		for (const subtitle of globalState.getSubtitleTrack.clips) {
			// Skip les clips silencieux ou sans texte
			if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
				continue;

			const startTime = subtitle.startTime;
			const endTime = subtitle.endTime;

			let text = '';

			for (const target of settings.includedTargets) {
				if (target === 'arabic') {
					text += subtitle.getText();
				} else {
					if (subtitle instanceof SubtitleClip)
						text += subtitle.getTranslation(target).getText(target, subtitle);
					else if (subtitle instanceof PredefinedSubtitleClip)
						text += subtitle.getTranslation(target).getText(); // Pas de numéro de verset, donc getText() suffit
				}

				text += '\n';
			}

			subtitles.push({
				startTimeMs: startTime,
				endTimeMs: endTime,
				text: text.trim()
			});
		}

		const fileContent = SubtitleFileContentGenerator.generateSubtitleFile(
			subtitles,
			settings.format
		);

		// Téléchargez le fichier
		const blob = new Blob([fileContent], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `qurancaption_subtitles_${globalState.currentProject!.detail.name}.${settings.format.toLowerCase()}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	static exportProjectData() {
		const projectData = globalState.currentProject;

		if (!projectData) {
			console.error('No project data available for export.');
			return;
		}

		const json = JSON.stringify(projectData, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `qurancaption_project_${projectData.detail.name}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	static exportYtbChapters() {
		const choice = globalState.getExportState.ytbChaptersChoice;
		const subtitlesClips: SubtitleClip[] = globalState.getSubtitleClips;

		if (!subtitlesClips || subtitlesClips.length === 0) {
			console.error('No subtitle clips available for export.');
			return;
		}

		let chapters: { time: string; title: string }[] = [];

		if (choice === 'Each Surah') {
			// Groupe par sourate
			let currentSurah = -1;

			for (const clip of subtitlesClips) {
				if (!(clip instanceof SubtitleClip)) continue;

				if (clip.surah !== currentSurah) {
					currentSurah = clip.surah;
					const timeFormatted = Exporter.formatTimeForYouTube(clip.startTime);
					const surahName = Quran.surahs[currentSurah - 1]?.name || `Surah ${currentSurah}`;
					chapters.push({
						time: timeFormatted,
						title: `Surah ${surahName}`
					});
				}
			}
		} else if (choice === 'Each Verse') {
			// Groupe par verset
			let lastSurahVerse = '';

			for (const clip of subtitlesClips) {
				if (!(clip instanceof SubtitleClip)) continue;

				const currentSurahVerse = `${clip.surah}:${clip.verse}`;
				if (currentSurahVerse !== lastSurahVerse) {
					lastSurahVerse = currentSurahVerse;
					const timeFormatted = Exporter.formatTimeForYouTube(clip.startTime);
					chapters.push({
						time: timeFormatted,
						title: `${clip.surah}:${clip.verse}`
					});
				}
			}
		}

		// S'assurer que le premier timestamp est 0:00 pour la compatibilité YouTube
		if (chapters.length > 0 && chapters[0].time !== '0:00') {
			chapters[0].time = '0:00';
		}

		// Génère le contenu du fichier
		let fileContent = 'YouTube Chapters:\n\n';
		for (const chapter of chapters) {
			fileContent += `${chapter.time} ${chapter.title}\n`;
		}

		// Télécharge le fichier
		const blob = new Blob([fileContent], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `qurancaption_chapters_${globalState.currentProject!.detail.name}.txt`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	/**
	 * Convertit le temps en millisecondes au format YouTube (MM:SS ou HH:MM:SS)
	 */
	private static formatTimeForYouTube(timeMs: number): string {
		const totalSeconds = Math.floor(timeMs / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}

	/**
	 * Exporte le projet sous forme de vidéo.
	 */
	static async exportVideo() {
		// Génère un ID d'export unique.
		const exportId = Utilities.randomId().toString();

		// Fait une copie du projet à l'état actuelle
		const project = globalState.currentProject!.clone();
		project.detail.id = Number(exportId); // L'ID du projet est l'ID d'export

		// Créer le fichier du projet dans le dossier Export afin que l'Exporter le récupère
		await ExportService.saveProject(project);

		// Ajoute à la liste des exports en cours
		await ExportService.addExport(project);

		// Ouvre le popup de monitor d'export
		globalState.uiState.showExportMonitor = true;

		// Set-up l'écouteur d'évènement pour suivre
		// le progrès des projets en cours d'exportation
		ExportService.setupListener();

		// Créer une fenêtre Tauri avec la bonne taille
		const w = new WebviewWindow(exportId, {
			decorations: false,
			visible: true,
			alwaysOnTop: false,
			title: 'QC - ' + exportId,
			url: '/exporter?' + new URLSearchParams({ id: exportId }) // Met en paramètre l'ID de l'export pour que l'exportateur puisse le récupérer
		});

		// listen  to close
		w.listen('tauri://close-requested', async (e) => {
			try {
				// Supprime le dossier temporaire des images
				await remove(await join(ExportService.exportFolder, exportId), {
					baseDir: BaseDirectory.AppData,
					recursive: true
				});
			} catch (error) {
				console.error('Error removing temporary images folder:', error);
			} finally {
				// ferme la fenêtre
				await w.destroy();
			}
		});
	}
}
