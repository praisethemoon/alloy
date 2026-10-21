// Re-creates models/ and snippets/ from their sources at the pinned commits.
// Run with `node test/fixtures/third-party/import.mjs`; needs git and the network.
// The result is committed: `npm test` checks every .als file under both folders.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Whole models, all accepted by the Analyzer: they must give no diagnostics of ours at all. */
const models = [{
    name: "alloytools-models",
    repository: "https://github.com/AlloyTools/models",
    commit: "886447d3369a9036aa4c3b49a82d7c557ab2e5f9",
    license: "LICENSE",
    // Rejected by the Analyzer 6.2.0 on their own: copies of the util library
    // that open util/integer, "imported infinitely often".
    excluded: ["boolean", "graph", "integer", "natural", "ordering", "relation", "seqrel", "sequence", "sequniv", "ternary"]
        .map(name => `utilities/types/${name}.als`)
}];

/**
 * Tree-sitter grammar test cases, one .als file per case. They name sigs and
 * preds they never declare, so the Analyzer rejects most of them, but it
 * parses them all: they must give no syntax errors of ours.
 */
const snippets = [{
    name: "vincentlu",
    repository: "https://github.com/vincentlu/tree-sitter-alloy",
    commit: "7bcc865b0d12ff4f20876efd072fd1bc11faff48",
    license: "LICENSE"
}, {
    name: "fore-stun",
    repository: "https://github.com/fore-stun/tree-sitter-alloy",
    commit: "26d70b6745d10380b87a98a25cd7159c68a0f668",
    license: "LICENSE"
}];

/** A shallow checkout of one commit in a fresh temporary folder. */
function checkout(repository, commit) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-third-party-"));
    const git = (...args) => execFileSync("git", ["-C", folder, ...args], { stdio: "inherit" });
    git("init", "--quiet");
    git("fetch", "--quiet", "--depth", "1", repository, commit);
    git("checkout", "--quiet", "FETCH_HEAD");
    return folder;
}

/** The cases of a tree-sitter corpus file: each title and the source above its `---` line. */
function corpusCases(text) {
    const parts = text.split(/^={3,}[^\n]*\n(.*?)\n={3,}[^\n]*\n/ms);
    const cases = [];
    for (let i = 1; i < parts.length; i += 2) {
        const title = parts[i].trim().split("\n")[0];
        const source = parts[i + 1].split(/^-{3,}\s*$/m)[0].replace(/^\n+|\n+$/g, "");
        cases.push({ title, source });
    }
    return cases;
}

const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

for (const source of models) {
    const from = checkout(source.repository, source.commit);
    const to = path.join(here, "models", source.name);
    fs.rmSync(to, { recursive: true, force: true });
    for (const file of fs.readdirSync(from, { recursive: true, encoding: "utf-8" })) {
        if (!file.endsWith(".als") || source.excluded.includes(file)) continue;
        fs.mkdirSync(path.dirname(path.join(to, file)), { recursive: true });
        fs.copyFileSync(path.join(from, file), path.join(to, file));
    }
    fs.copyFileSync(path.join(from, source.license), path.join(to, "LICENSE"));
}

for (const source of snippets) {
    const from = checkout(source.repository, source.commit);
    const to = path.join(here, "snippets", source.name);
    fs.rmSync(to, { recursive: true, force: true });
    const corpus = path.join(from, "test", "corpus");
    for (const file of fs.readdirSync(corpus).sort()) {
        const folder = path.join(to, path.parse(file).name);
        fs.mkdirSync(folder, { recursive: true });
        corpusCases(fs.readFileSync(path.join(corpus, file), "utf-8")).forEach(({ title, source: text }, i) =>
            fs.writeFileSync(path.join(folder, `${String(i + 1).padStart(2, "0")}-${slug(title)}.als`), `${text}\n`));
    }
    fs.copyFileSync(path.join(from, source.license), path.join(to, "LICENSE"));
}
