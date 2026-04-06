const { existsSync, chmodSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = process.cwd();
const gitDir = join(repoRoot, '.git');
const hooksDir = join(repoRoot, '.githooks');
const preCommitHook = join(hooksDir, 'pre-commit');

if (!existsSync(gitDir)) {
	process.exit(0);
}

if (existsSync(preCommitHook)) {
	try {
		chmodSync(preCommitHook, 0o755);
	} catch (_error) {
		// Ignore chmod issues on platforms that don't support unix permissions.
	}
}

const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
	cwd: repoRoot,
	stdio: 'inherit'
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
