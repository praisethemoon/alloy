import { beforeAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { URI, type LangiumDocument } from "langium";
import { NodeFileSystem } from "langium/node";
import { createAlloyLspServices } from "alloy-lsp-language";

// The AlloyTools models, which the Analyzer accepts, give no diagnostics of
// ours either. Run `npm run corpus:fetch` once, then `npm run test:corpus`;
// it skips without the models.

const modelsDir = path.resolve(__dirname, "models");
const models = fs.existsSync(modelsDir)
    ? fs.readdirSync(modelsDir, { recursive: true, encoding: "utf-8" }).filter(file => file.endsWith(".als")).sort()
    : [];

// The Analyzer's only warning on the corpus is one we don't give: in
// book/chapter5/lists.als:18, `list != list` "is redundant, because the left
// and right expressions always have the same value". We have no redundancy check.

/** Diagnostics we give on a corpus model on purpose, as `line: severity: message`, and why. */
const recorded = new Map<string, { diagnostics: string[], why: string }>([]);

describe.skipIf(models.length === 0)("the AlloyTools corpus", () => {
    const documents = new Map<string, LangiumDocument>();

    beforeAll(async () => {
        const services = createAlloyLspServices(NodeFileSystem);
        const workspace = services.shared.workspace;
        await workspace.WorkspaceManager.initializeWorkspace([{ name: "corpus", uri: URI.file(modelsDir).toString() }]);
        const all = workspace.LangiumDocuments.all.filter(d => d.uri.scheme === "file").toArray();
        await workspace.DocumentBuilder.build(all, { validation: true });
        for (const document of all) {
            documents.set(path.relative(modelsDir, document.uri.fsPath), document);
        }
    }, 120_000);

    test.each(models)("%s", file => {
        const document = documents.get(file);
        expect(document, "the workspace should load every model").toBeDefined();
        const diagnostics = (document!.diagnostics ?? []).map(d =>
            `${d.range.start.line + 1}: ${d.severity === 1 ? "error" : "warning"}: ${typeof d.message === "string" ? d.message : d.message.value}`);
        expect(diagnostics).toEqual(recorded.get(file)?.diagnostics ?? []);
    });
});
