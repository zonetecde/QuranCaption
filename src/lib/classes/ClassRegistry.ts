import { SerializableBase } from './misc/SerializableBase';
import { Asset, Category, Style, StylePreset, StylesData, VerseRange, VideoStyle } from '.';
import {
	Clip,
	SubtitleClip,
	SilenceClip,
	PredefinedSubtitleClip,
	AssetClip,
	ClipWithTranslation,
	CustomTextClip,
	CustomImageClip,
	CustomClip
} from './Clip.svelte';
import { AssetTrack, CustomTextTrack, SubtitleTrack, Track } from './Track.svelte';
import { Timeline } from './Timeline.svelte';
import { ProjectContent } from './ProjectContent.svelte';
import { Project } from './Project';
import { ProjectDetail } from './ProjectDetail.svelte';
import {
	ProjectEditorState,
	StylesEditorState,
	SubtitlesEditorState,
	TimelineState,
	TranslationsEditorState,
	VideoPreviewState
} from './ProjectEditorState.svelte';
import { Translation, VerseTranslation, PredefinedSubtitleTranslation } from './Translation.svelte';
import { ProjectTranslation } from './ProjectTranslation.svelte';
import { Duration } from './Duration';
import { Status } from './Status';
import Exportation from './Exportation.svelte';
import Settings from './Settings.svelte';

/**
 * Enregistre automatiquement toutes les classes sérialisables pour permettre
 * la désérialisation automatique basée sur le nom de classe
 */
export function initializeClassRegistry() {
	// Classes de base
	SerializableBase.registerClass('VerseRange', VerseRange);
	SerializableBase.registerClass('Duration', Duration);
	SerializableBase.registerClass('Status', Status);
	SerializableBase.registerClass('Settings', Settings);

	// Classes de style
	SerializableBase.registerClass('VideoStyle', VideoStyle);
	SerializableBase.registerClass('Category', Category);
	SerializableBase.registerClass('Style', Style);
	SerializableBase.registerClass('StylesData', StylesData);
	SerializableBase.registerClass('StylePreset', StylePreset);

	// Classes de clips
	SerializableBase.registerClass('Clip', Clip);
	SerializableBase.registerClass('ClipWithTranslation', ClipWithTranslation);
	SerializableBase.registerClass('SilenceClip', SilenceClip);
	SerializableBase.registerClass('PredefinedSubtitleClip', PredefinedSubtitleClip);
	SerializableBase.registerClass('AssetClip', AssetClip);
	SerializableBase.registerClass('AssetTrack', AssetTrack);
	SerializableBase.registerClass('SubtitleTrack', SubtitleTrack);
	SerializableBase.registerClass('CustomTextTrack', CustomTextTrack);
	SerializableBase.registerClass('SubtitleClip', SubtitleClip);
	SerializableBase.registerClass('CustomClip', CustomClip);
	SerializableBase.registerClass('CustomTextClip', CustomTextClip);
	SerializableBase.registerClass('CustomImageClip', CustomImageClip);
	SerializableBase.registerClass('Asset', Asset);

	// Classes de projet
	SerializableBase.registerClass('Track', Track);
	SerializableBase.registerClass('Timeline', Timeline);
	SerializableBase.registerClass('ProjectContent', ProjectContent);
	SerializableBase.registerClass('Project', Project);
	SerializableBase.registerClass('ProjectDetail', ProjectDetail);
	// Classes d'état
	SerializableBase.registerClass('VideoPreviewState', VideoPreviewState);
	SerializableBase.registerClass('ProjectEditorState', ProjectEditorState);
	SerializableBase.registerClass('SubtitlesEditorState', SubtitlesEditorState);
	SerializableBase.registerClass('TimelineState', TimelineState);
	SerializableBase.registerClass('StylesEditorState', StylesEditorState);
	// Classes de traduction
	SerializableBase.registerClass('ProjectTranslation', ProjectTranslation);
	SerializableBase.registerClass('Translation', Translation);
	SerializableBase.registerClass('VerseTranslation', VerseTranslation);
	SerializableBase.registerClass('PredefinedSubtitleTranslation', PredefinedSubtitleTranslation);
	SerializableBase.registerClass('TranslationsEditorState', TranslationsEditorState);

	// Classe d'exportation
	SerializableBase.registerClass('Exportation', Exportation);
}
