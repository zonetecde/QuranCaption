export interface FolderDetail {
	id: number;
	name: string;
	color: string; // hex value from palette
	createdAt: string; // ISO string
}

export const FOLDER_COLOR_PALETTE: string[] = [
	'#ef4444', // red
	'#f97316', // orange
	'#eab308', // yellow
	'#22c55e', // green
	'#3b82f6', // blue
	'#8b5cf6', // violet
	'#ec4899', // pink
	'#6b7280' // gray
];
