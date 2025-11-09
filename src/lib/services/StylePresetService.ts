import type { Project } from '$lib/classes';
import { TrackType, Utilities } from '$lib/classes';
import { CustomImageClip, CustomTextClip } from '$lib/classes/Clip.svelte';
import { CustomTextTrack } from '$lib/classes/Track.svelte';
import { VideoStyle, type VideoStyleFileData } from '$lib/classes/VideoStyle.svelte';

export function extractStyleSnapshotFromProject(project: Project): VideoStyleFileData {
	const timeline = project.content.timeline;
	let customClips: any[] = [];

	if (timeline.doesTrackExist(TrackType.CustomClip)) {
		const track = timeline.getFirstTrack(TrackType.CustomClip) as CustomTextTrack;
		customClips = track.clips.map((clip) => clip.toJSON());
	}

	return {
		videoStyle: project.content.videoStyle.toJSON(),
		customClips
	};
}

export async function applyStyleSnapshotToProject(project: Project, snapshot?: VideoStyleFileData) {
	if (!snapshot) return;

	project.content.videoStyle = VideoStyle.fromJSON(snapshot.videoStyle);
	await project.content.videoStyle.loadAllCompositeStyles();

	const timeline = project.content.timeline;
	if (!timeline.doesTrackExist(TrackType.CustomClip)) {
		return;
	}

	const track = timeline.getFirstTrack(TrackType.CustomClip) as CustomTextTrack;
	const clipsData = snapshot.customClips ?? [];

	track.clips = clipsData.map((clipData) => {
		const clip =
			clipData.type === 'Custom Image'
				? CustomImageClip.fromJSON(clipData)
				: CustomTextClip.fromJSON(clipData);
		clip.id = Utilities.randomId();
		return clip;
	});
}
