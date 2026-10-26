const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

for (const directory of ['src', 'scripts', 'test']) {
    for (const file of readdirSync(directory, { recursive: true })) {
        if (!file.endsWith('.js')) continue;
        const result = spawnSync(process.execPath, ['--check', join(directory, file)], { stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status || 1);
    }
}
