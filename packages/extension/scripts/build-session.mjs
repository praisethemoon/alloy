// Compiles the Java session helper (java/alloylsp) against the shipped Alloy jar
// into alloy/alloy-session.jar, which the extension ships beside it. Skips the
// work when the jar is newer than every source. Needs a JDK (javac and jar).

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = path.join(root, 'java', 'alloylsp');
const alloyJar = path.join(root, 'alloy', 'alloy.jar');
const sessionJar = path.join(root, 'alloy', 'alloy-session.jar');

const javaFiles = fs.readdirSync(sources).filter(f => f.endsWith('.java')).map(f => path.join(sources, f));
const newest = Math.max(...javaFiles.map(f => fs.statSync(f).mtimeMs));
if (fs.existsSync(sessionJar) && fs.statSync(sessionJar).mtimeMs > newest) {
    process.exit(0);
}
if (!fs.existsSync(alloyJar)) {
    console.error(`${alloyJar} is missing; run scripts/fetch-alloy.mjs first.`);
    process.exit(1);
}

const classes = fs.mkdtempSync(path.join(os.tmpdir(), 'alloy-session-'));
try {
    execFileSync('javac', ['--release', '17', '-Xlint:all', '-Werror', '-cp', alloyJar, '-d', classes, ...javaFiles], { stdio: 'inherit' });
    execFileSync('jar', ['--create', '--file', sessionJar, '-C', classes, '.'], { stdio: 'inherit' });
} catch (error) {
    console.error(error.code === 'ENOENT'
        ? 'Building the Alloy session helper needs a JDK (javac and jar) on the PATH.'
        : 'Building the Alloy session helper failed.');
    process.exit(1);
} finally {
    fs.rmSync(classes, { recursive: true, force: true });
}
console.log(`Alloy session helper built: ${sessionJar}`);
