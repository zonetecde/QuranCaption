import { invoke } from '@tauri-apps/api/core';

const HF_CHANGELOG_URL =
	'https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/raw/main/docs/CHANGELOG.md';

export type HuggingFaceChangelogSection = {
	title: string;
	items: string[];
};

function normalizeLine(line: string): string {
	return line.trim().replace(/\r/g, '');
}

export function parseHuggingFaceChangelog(markdown: string): HuggingFaceChangelogSection[] {
	const lines = markdown.split('\n').map(normalizeLine);
	const sections: HuggingFaceChangelogSection[] = [];
	let currentSection: HuggingFaceChangelogSection | null = null;

	for (const line of lines) {
		if (!line) continue;

		if (line.startsWith('## ')) {
			currentSection = {
				title: line.slice(3).trim(),
				items: []
			};
			sections.push(currentSection);
			continue;
		}

		if (line.startsWith('- ') && currentSection) {
			currentSection.items.push(line.slice(2).trim());
		}
	}

	return sections.filter((section) => section.title.length > 0 && section.items.length > 0);
}

export async function fetchQuranMultiAlignerChangelog(): Promise<HuggingFaceChangelogSection[]> {
	const rawMarkdown = await invoke<string>('send_http_text', { url: HF_CHANGELOG_URL });
	return parseHuggingFaceChangelog(rawMarkdown);
}
