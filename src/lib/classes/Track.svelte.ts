import { Clip } from './Clip.svelte.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Track } from './tracks/Track.svelte.js';

export { Track };
export { AssetTrack } from './tracks/AssetTrack.svelte.js';
export {
	SubtitleTrack,
	type VisualMergeGroup,
	type VisualMergeSelection
} from './tracks/SubtitleTrack.svelte.js';
export { CustomTextTrack } from './tracks/CustomTextTrack.svelte.js';

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Track, 'clips', Clip);
