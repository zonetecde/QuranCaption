import type { Mp3QuranMoshaf } from '$lib/services/Mp3QuranService';
import type { Edition } from '$lib/classes';

/** Mode de source video de fond. */
export type BackgroundSourceMode = 'ai' | 'youtube' | 'none';

/** Orientation video. */
export type Resolution = 'portrait' | 'landscape';

/** Etape du wizard. */
export type Step = 'input' | 'review';

/** Plage de versets (sourate + debut/fin). */
export interface VerseRange {
	surah: number;
	startVerse: number;
	endVerse: number;
}

/** Option de intervenant Hafs A'n Assem / 114 sourates chargee depuis MP3Quran. */
export interface SpeakerOption {
	label: string;
	speakerName: string;
	moshaf: Mp3QuranMoshaf;
	speakerId: number;
	surahSet: Set<number>;
}

/** Configuration de la source video (IA ou YouTube). */
export interface VideoSource {
	sourceMode: BackgroundSourceMode;
	prompt: string;
	youtubeUrl: string;
	model: string;
	resolution: Resolution;
}

/** Options de comportement IA. */
export interface AiOptions {
	letAiChoose: boolean;
	isGeneratingPlan: boolean;
}

/** Configuration de la source audio (MP3Quran ou fichier local). */
export interface AudioSource {
	useLocal: boolean;
	localPath: string;
	speakerName: string;
	speaker: SpeakerOption | null;
}

/** Resultat du plan IA (sourate + versets + intervenant + titre + prompt video). */
export interface AiPlan {
	title: string;
	videoPrompt: string;
	speaker: string;
	speakerId: number;
	surah: number;
	ayahStart: number;
	ayahEnd: number;
}

/** Etat de l'etape de review. */
export interface ReviewState {
	title: string;
	videoPrompt: string;
	speakerName: string;
	verseRange: VerseRange;
}

/** Modele mocked pour la generation video. */
export interface MockModel {
	provider: string;
	model: string;
	label: string;
}

/** Etat complet de la feature AI Video (stocke dans globalState.aiVideo). */
export interface AiVideoState {
	step: Step;
	video: VideoSource;
	ai: AiOptions;
	audio: AudioSource;
	selectedVerseRange: VerseRange;
	selectedTranslation: Edition | null;
	review: ReviewState;
	isCreatingProject: boolean;
	generationStatus: string;
	speakerOptions: SpeakerOption[];
	isLoadingSpeakers: boolean;
}
