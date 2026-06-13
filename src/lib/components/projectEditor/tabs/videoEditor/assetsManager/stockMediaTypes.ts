export type StockMediaSource = 'pexels' | 'pixabay';

export type StockMediaType = 'all' | 'photo' | 'video';

export interface StockMediaResult {
	id: string;
	source: StockMediaSource;
	type: 'photo' | 'video';
	previewUrl: string;
	thumbnailUrl: string;
	downloadUrl: string;
	previewVideoUrl: string;
	width: number;
	height: number;
	duration?: number;
	authorName: string;
	authorUrl: string;
	pageUrl: string;
}

export interface StockMediaLibraryState {
	libraryOpen: boolean;
	searchQuery: string;
	source: StockMediaSource;
	mediaType: StockMediaType;
	results: StockMediaResult[];
	isLoading: boolean;
	error: string | null;
	page: number;
	hasMore: boolean;
	downloadingId: string | null;
}
