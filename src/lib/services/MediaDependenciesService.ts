import { invoke } from '@tauri-apps/api/core';

export type MediaBinaryName = 'ffmpeg' | 'ffprobe' | 'yt-dlp';

type BinaryResolutionAttempt = {
	candidate: string;
	source: string;
	outcome: string;
	detail?: string | null;
};

type BinaryDiagnosticResult = {
	name: string;
	resolved_path?: string | null;
	error_code?: string | null;
	error_details?: string | null;
	attempts: BinaryResolutionAttempt[];
	version_output?: string | null;
};

export type MediaBinaryStatus = {
	name: MediaBinaryName;
	installed: boolean;
	resolvedPath: string | null;
	errorCode: string | null;
	errorDetails: string | null;
	versionOutput: string | null;
	attempts: BinaryResolutionAttempt[];
};

export type MediaInstallResult = {
	installed: string[];
	already_present: string[];
	failed: Array<{ name: string; reason: string }>;
};

export type MediaDependencyGateState = {
	binaryStatuses: MediaBinaryStatus[];
	statusByName: Record<MediaBinaryName, MediaBinaryStatus>;
	missingRequired: MediaBinaryName[];
	isStartupBlocked: boolean;
	isYtDlpMissing: boolean;
};

function extractErrorMessage(error: unknown): string {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === 'string') return message;
	}
	return String(error ?? '');
}

function toBinaryName(value: string): MediaBinaryName | null {
	if (value === 'ffmpeg' || value === 'ffprobe' || value === 'yt-dlp') return value;
	return null;
}

function defaultStatus(name: MediaBinaryName): MediaBinaryStatus {
	return {
		name,
		installed: false,
		resolvedPath: null,
		errorCode: 'BINARY_NOT_FOUND',
		errorDetails: null,
		versionOutput: null,
		attempts: []
	};
}

function toBinaryStatus(result: BinaryDiagnosticResult): MediaBinaryStatus | null {
	const name = toBinaryName(result.name);
	if (!name) return null;
	return {
		name,
		installed: !!result.resolved_path,
		resolvedPath: result.resolved_path ?? null,
		errorCode: result.error_code ?? null,
		errorDetails: result.error_details ?? null,
		versionOutput: result.version_output ?? null,
		attempts: result.attempts ?? []
	};
}

export async function checkMediaDependencies(): Promise<MediaDependencyGateState> {
	const diagnostics = (await invoke('diagnose_media_binaries')) as BinaryDiagnosticResult[];
	const parsed = diagnostics.map(toBinaryStatus).filter((s): s is MediaBinaryStatus => !!s);

	const statusByName: Record<MediaBinaryName, MediaBinaryStatus> = {
		ffmpeg: parsed.find((s) => s.name === 'ffmpeg') ?? defaultStatus('ffmpeg'),
		ffprobe: parsed.find((s) => s.name === 'ffprobe') ?? defaultStatus('ffprobe'),
		'yt-dlp': parsed.find((s) => s.name === 'yt-dlp') ?? defaultStatus('yt-dlp')
	};

	const missingRequired = (['ffmpeg', 'ffprobe'] as const).filter(
		(name) => !statusByName[name].installed
	);

	return {
		binaryStatuses: [statusByName.ffmpeg, statusByName.ffprobe, statusByName['yt-dlp']],
		statusByName,
		missingRequired,
		isStartupBlocked: missingRequired.length > 0,
		isYtDlpMissing: !statusByName['yt-dlp'].installed
	};
}

export async function installMediaDependencies(options?: {
	includeYtDlp?: boolean;
	onlyMissing?: boolean;
}): Promise<MediaInstallResult> {
	const payload = {
		includeYtDlp: options?.includeYtDlp ?? true,
		onlyMissing: options?.onlyMissing ?? true
	};
	return (await invoke('install_media_binaries', { payload })) as MediaInstallResult;
}

export function isYtDlpMissingError(error: unknown): boolean {
	const message = extractErrorMessage(error).toUpperCase();
	return (
		message.includes('YTDLP_NOT_FOUND') ||
		message.includes('YTDLP_NOT_EXECUTABLE') ||
		message.includes('YTDLP_EXEC_FAILED') ||
		message.includes('YT-DLP BINARY NOT FOUND') ||
		message.includes('YT-DLP BINARY NOT')
	);
}

function getOsFromUserAgent(): 'windows' | 'macos' | 'linux' {
	const userAgent = navigator?.userAgent?.toLowerCase() ?? '';
	if (userAgent.includes('win')) return 'windows';
	if (userAgent.includes('mac')) return 'macos';
	return 'linux';
}

export function getManualInstallHelp(missing: MediaBinaryName[]): string[] {
	const os = getOsFromUserAgent();
	const needsFfmpeg = missing.includes('ffmpeg') || missing.includes('ffprobe');
	const needsYtDlp = missing.includes('yt-dlp');
	const lines: string[] = [];

	if (os === 'windows') {
		if (needsFfmpeg) {
			lines.push(
				"Windows (FFmpeg): download 'ffmpeg-release-essentials.zip' from gyan.dev, then copy `ffmpeg.exe` and `ffprobe.exe` into your PATH."
			);
		}
		if (needsYtDlp) {
			lines.push(
				"Windows (yt-dlp): download `yt-dlp.exe` from GitHub releases and place it in a folder already in PATH."
			);
		}
		return lines;
	}

	if (os === 'macos') {
		if (needsFfmpeg) {
			lines.push(
				'macOS (FFmpeg): easiest is `brew install ffmpeg` (installs both ffmpeg and ffprobe).'
			);
		}
		if (needsYtDlp) {
			lines.push('macOS (yt-dlp): easiest is `brew install yt-dlp`.');
		}
		return lines;
	}

	if (needsFfmpeg) {
		lines.push(
			'Linux (FFmpeg): install with your package manager, e.g. `sudo apt install ffmpeg`, `sudo dnf install ffmpeg`, or `sudo pacman -S ffmpeg`.'
		);
	}
	if (needsYtDlp) {
		lines.push(
			'Linux (yt-dlp): install with your package manager when available, or download the `yt-dlp` binary from GitHub releases and make it executable.'
		);
	}
	return lines;
}
