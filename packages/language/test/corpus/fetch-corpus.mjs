// Downloads the AlloyTools model corpus into test/corpus/models (git-ignored),
// for `npm run test:corpus`. Only the .als files are checked out, at a fixed
// commit so that every run sees the same models. Needs git and the network.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "https://github.com/AlloyTools/org.alloytools.alloy";
const commit = "ed89fdb16c58aea17a55e312c44f99e31aa63ee1";
// The book and example models, the core's test models and the CLI's.
const patterns = [
    "/org.alloytools.alloy.extra/extra/models/**/*.als",
    "/**/src/test/**/*.als",
    "/org.alloytools.alloy.cli/test*.als"
];

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "models");
const git = (...args) => execFileSync("git", ["-C", target, ...args], { stdio: "inherit" });

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
git("init", "--quiet");
git("remote", "add", "origin", repository);
git("sparse-checkout", "set", "--no-cone", ...patterns);
git("fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", commit);
git("checkout", "--quiet", "FETCH_HEAD");

const models = fs.readdirSync(target, { recursive: true, encoding: "utf-8" }).filter(file => file.endsWith(".als"));
console.log(`${models.length} models in ${target}`);
