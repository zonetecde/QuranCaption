import { describe, expect, it } from 'vitest';

import { getFfmpegUpdateCommands } from '$lib/services/FfmpegUpdateHelp';

const outdatedFfmpegError = "Unrecognized option '/filter_complex'.";

describe('FFmpeg update help', () => {
	it('returns macOS Homebrew commands for the unsupported filter option', () => {
		expect(getFfmpegUpdateCommands(outdatedFfmpegError, 'Macintosh')).toContain(
			'brew unlink ffmpeg@6'
		);
	});

	it('returns Windows winget commands for the unsupported filter option', () => {
		expect(getFfmpegUpdateCommands(outdatedFfmpegError, 'Windows NT')).toContain(
			'winget upgrade --id Gyan.FFmpeg --exact'
		);
	});

	it('returns Linux apt commands for the unsupported filter option', () => {
		expect(getFfmpegUpdateCommands(outdatedFfmpegError, 'Linux x86_64')).toContain(
			'sudo apt install ffmpeg'
		);
	});

	it('does not add update commands to unrelated export errors', () => {
		expect(getFfmpegUpdateCommands('Encoder failed', 'Macintosh')).toBeNull();
	});
});
