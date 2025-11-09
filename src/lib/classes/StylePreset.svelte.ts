import { SerializableBase } from './misc/SerializableBase';
import { Utilities } from './misc/Utilities';
import type { VideoStyleFileData } from './VideoStyle.svelte';

export class StylePreset extends SerializableBase {
	id: number = $state(Utilities.randomId());
	name: string = $state('');
	sourceProjectId: number | null = $state(null);
	createdAt: Date = $state(new Date());
	data: VideoStyleFileData = $state({
		videoStyle: {},
		customClips: []
	});

	constructor(name: string = '', sourceProjectId: number | null = null, data?: VideoStyleFileData) {
		super();
		this.name = name;
		this.sourceProjectId = sourceProjectId;

		if (data) {
			this.data = data;
		}
	}
}
