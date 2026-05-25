import type {
	CommunityPresetOrientation,
	CommunityPresetSort,
	CommunityPresetTag,
	CommunityStylePreset
} from '$lib/services/StylePresetLibraryService';

export type {
	CommunityPresetOrientation,
	CommunityPresetSort,
	CommunityPresetTag,
	CommunityStylePreset
};

export type ModalMode = 'save' | 'export';

export type DimensionValue = { width: number; height: number };

/** État réactif complet de la librairie de presets (stocké dans globalState.presetLibrary). */
export type PresetLibraryState = {
	libraryOpen: boolean;
	publishMode: boolean;

	// Navigation communauté
	communitySearchQuery: string;
	selectedTag: string;
	selectedOrientation: CommunityPresetOrientation | 'all';
	selectedSort: CommunityPresetSort;
	communityPresets: CommunityStylePreset[];
	popularTags: CommunityPresetTag[];
	isLoadingCommunity: boolean;
	communityError: string | null;
	downloadingPresetId: string | null;
	likingPresetId: string | null;
	likedPresetIds: Set<string>;

	// Publication
	publishName: string;
	publishAuthorName: string;
	publishDescription: string;
	publishTags: string;
	publishPreviewBlob: Blob | null;
	publishPreviewUrl: string;
	publishError: string | null;
	isGeneratingPreview: boolean;
	isPublishing: boolean;
	lastPreviewClipId: number | null;
	includedCustomClipIds: Set<number>;
	lastCapturedInclusion: Set<number> | null;

	// Presets locaux
	localSearchQuery: string;
	modalMode: ModalMode | null;
};
