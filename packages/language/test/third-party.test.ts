import { beforeAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { URI, type LangiumDocument } from "langium";
import { NodeFileSystem } from "langium/node";
import { createAlloyLspServices } from "alloy-lsp-language";
import { parse, syntaxErrors } from "./helpers.js";

// Alloy inputs written by others, copied by fixtures/third-party/import.mjs.

const thirdParty = path.resolve(__dirname, "fixtures/third-party");
const alsFiles = (folder: string) => fs.readdirSync(folder, { recursive: true, encoding: "utf-8" })
    .filter(file => file.endsWith(".als")).sort();

const modelsDir = path.join(thirdParty, "models");
const snippetsDir = path.join(thirdParty, "snippets");

describe("third-party models, all accepted by the Analyzer, give no diagnostics", () => {
    const documents = new Map<string, LangiumDocument>();

    beforeAll(async () => {
        // One workspace, so that models opening each other by path find one another.
        const services = createAlloyLspServices(NodeFileSystem);
        const workspace = services.shared.workspace;
        await workspace.WorkspaceManager.initializeWorkspace([{ name: "models", uri: URI.file(modelsDir).toString() }]);
        const all = workspace.LangiumDocuments.all.filter(d => d.uri.scheme === "file").toArray();
        await workspace.DocumentBuilder.build(all, { validation: true });
        for (const document of all) {
            documents.set(path.relative(modelsDir, document.uri.fsPath), document);
        }
    }, 60_000);

    test.each(alsFiles(modelsDir))("%s", file => {
        const document = documents.get(file);
        expect(document, "the workspace should load every model").toBeDefined();
        expect((document!.diagnostics ?? []).map(d =>
            `${d.range.start.line + 1}: ${d.severity === 1 ? "error" : "warning"}: ${typeof d.message === "string" ? d.message : d.message.value}`)).toEqual([]);
    });
});

describe("third-party grammar test cases parse", () => {
    // They name sigs and preds they never declare, so only their syntax is checked.
    test.each(alsFiles(snippetsDir))("%s", async file => {
        const document = await parse(fs.readFileSync(path.join(snippetsDir, file), "utf-8"), `file:///third-party/${file}`);
        expect(syntaxErrors(document)).toEqual([]);
    });
});
