// Downloads the Alloy jar the extension ships into alloy/alloy.jar (git-ignored),
// and checks it against its pinned SHA-256. Does nothing when a valid jar is
// already there. Run by `npm run build`; the tests use the same file.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '6.2.0';
const url = `https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v${version}/org.alloytools.alloy.dist.jar`;
const sha256 = '6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d';

const jar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../alloy/alloy.jar');
const hashOf = bytes => createHash('sha256').update(bytes).digest('hex');

if (fs.existsSync(jar) && hashOf(fs.readFileSync(jar)) === sha256) {
    process.exit(0);
}

console.log(`Downloading Alloy ${version} from ${url}`);
const response = await fetch(url);
if (!response.ok) {
    console.error(`Download failed: ${response.status} ${response.statusText}`);
    process.exit(1);
}
const bytes = Buffer.from(await response.arrayBuffer());
const actual = hashOf(bytes);
if (actual !== sha256) {
    console.error(`The downloaded jar's SHA-256 is ${actual}, not the pinned ${sha256}; not using it.`);
    process.exit(1);
}
fs.mkdirSync(path.dirname(jar), { recursive: true });
fs.writeFileSync(`${jar}.tmp`, bytes);
fs.renameSync(`${jar}.tmp`, jar);
console.log(`Alloy ${version} saved to ${jar}`);
