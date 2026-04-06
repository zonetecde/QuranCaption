const { spawnSync } = require('node:child_process');

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		...options
	});

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

run('npx', ['svelte-kit', 'sync']);
run('node', ['scripts/setup-git-hooks.cjs']);
