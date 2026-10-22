// Packages the extension as alloy-<version>.vsix. vsce first runs the
// vscode:prepublish script, which is the extension's full build. vsce only
// takes the README, CHANGELOG and LICENSE from the package's own folder, so the
// repository's are copied in, and the README's relative links and images are
// pointed at the repository on GitHub, where the Marketplace page can reach them.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repo = path.resolve(here, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf-8'));

for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE']) {
    fs.copyFileSync(path.join(repo, file), path.join(here, file));
}

const github = manifest.repository.url;
const out = path.join(here, `${manifest.name}-${manifest.version}.vsix`);
const vsce = path.join(path.dirname(createRequire(import.meta.url).resolve('@vscode/vsce/package.json')), 'vsce');
execFileSync(process.execPath, [vsce, 'package', '--no-dependencies', '--out', out,
    '--baseContentUrl', `${github}/blob/HEAD`, '--baseImagesUrl', `${github}/raw/HEAD`], { cwd: here, stdio: 'inherit' });
console.log(`package: ${path.relative(repo, out)}`);
