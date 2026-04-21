export type ImportedProjectPayload = {
	detail: { id: number; folderId?: number };
	folderDetail?: { id: number; name: string; color: string; createdAt: string };
	[key: string]: unknown;
};
