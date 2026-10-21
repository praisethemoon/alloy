import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DocumentValidator, type LangiumDocument } from "langium";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CodeAction, Diagnostic, Position, TextEdit } from "vscode-languageserver";
import { MUTABLE_MODIFIER, utilLibrary, type AlloySemanticTokenProvider } from "alloy-lsp-language";
import { alloyServices, parse } from "./helpers.js";

const examplesDir = path.resolve(__dirname, "../../../examples");

let counter = 0;
const nextUri = (name = "model") => `file:///editing/${name}${++counter}.als`;

async function parseAt(text: string, uri = nextUri()): Promise<{ document: LangiumDocument, position: Position }> {
    const offset = text.indexOf("<|>");
    const document = await parse(text.slice(0, offset) + text.slice(offset + 3), uri);
    return { document, position: document.textDocument.positionAt(offset) };
}

function applied(text: string, edits: TextEdit[]): string {
    return TextDocument.applyEdits(TextDocument.create("file:///x.als", "alloy-lsp", 1, text), edits);
}

async function format(text: string): Promise<string> {
    const services = await alloyServices();
    const document = await parse(text, nextUri("format"));
    const edits = await services.AlloyLsp.lsp.Formatter!.formatDocument(document, {
        textDocument: { uri: document.uri.toString() }, options: { tabSize: 4, insertSpaces: true }
    });
    return applied(text, edits);
}

/** The tokens' images, so two texts can be compared ignoring layout. */
async function tokens(text: string): Promise<string[]> {
    const services = await alloyServices();
    return services.AlloyLsp.parser.Lexer.tokenize(text).tokens.map(t => t.image);
}

describe("semantic highlighting", () => {
    test("declarations and references get their kind, and var sigs and fields are marked mutable", async () => {
        const services = await alloyServices();
        const document = await parse("var sig S { var f: S, g: S }\npred p[x: S] { some x.f and x.g = x }", nextUri());
        const provider = services.AlloyLsp.lsp.SemanticTokenProvider as AlloySemanticTokenProvider;
        const { data } = await provider.semanticHighlight(document, { textDocument: { uri: document.uri.toString() } });
        const typeNames = Object.fromEntries(Object.entries(provider.tokenTypes).map(([name, index]) => [index, name]));
        const modifierNames = Object.entries(provider.tokenModifiers);
        const decoded: string[] = [];
        let line = 0, char = 0;
        for (let i = 0; i < data.length; i += 5) {
            line += data[i];
            char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
            const text = document.textDocument.getText({ start: { line, character: char }, end: { line, character: char + data[i + 2] } });
            const modifiers = modifierNames.filter(([, bit]) => data[i + 4] & bit).map(([name]) => name);
            decoded.push(`${text}:${typeNames[data[i + 3]]}${modifiers.length ? `[${modifiers.join(",")}]` : ""}`);
        }
        expect(decoded).toEqual([
            `S:class[declaration,${MUTABLE_MODIFIER}]`,
            `f:property[declaration,${MUTABLE_MODIFIER}]`, `S:class[${MUTABLE_MODIFIER}]`,
            "g:property[declaration]", `S:class[${MUTABLE_MODIFIER}]`,
            "p:method[declaration]", "x:parameter[declaration]", `S:class[${MUTABLE_MODIFIER}]`,
            "x:parameter", `f:property[${MUTABLE_MODIFIER}]`, "x:parameter", "g:property", "x:parameter"
        ]);
    });
});

describe("formatting", () => {
    test("lays out paragraphs, blocks, operators and commas", async () => {
        expect(await format("sig A{f:A,g :  A}\nfact{some A.f}\npred p [ a:A ,b:A ]{\na in b   a=b}")).toBe(
            "sig A { f: A, g: A }\nfact { some A.f }\npred p [a: A, b: A] {\n    a in b\n    a = b\n}");
    });

    test("keeps comments where they are", async () => {
        const text = "// the people\nsig Person {} -- nobody yet\n/* facts */\nfact { no Person }";
        expect(await format(text)).toBe(text);
    });

    test("keeps comments inside fields and blocks at their line's indentation", async () => {
        const text = [
            "sig Person {",
            "    /** first */",
            "    a: Person,",
            "    /** after a comma */",
            "    b: Person, // trailing stays",
            "    c: Person",
            "    -- before the brace",
            "}",
            "fact {",
            "    // a line comment",
            "    some Person",
            "    /* a block comment */",
            "    no none",
            "    // before the brace",
            "}"
        ].join("\n");
        expect(await format(text)).toBe(text);
        expect(await format(text.replace(/^    /gm, "  "))).toBe(text);
    });

    test.each(fs.readdirSync(examplesDir, { recursive: true, encoding: "utf-8" }).filter(f => f.endsWith(".als")).sort())(
        "examples/%s formats to itself", async file => {
            const text = fs.readFileSync(path.join(examplesDir, file), "utf-8");
            expect(await format(text)).toBe(text);
        });

    test.each(Object.keys(utilLibrary).sort())("%s formats idempotently and keeps its tokens", async module => {
        const once = await format(utilLibrary[module]);
        expect(await format(once)).toBe(once);
        expect(await tokens(once)).toEqual(await tokens(utilLibrary[module]));
    });
});

describe("folding", () => {
    test("multi-line paragraphs, blocks and comments fold", async () => {
        const services = await alloyServices();
        const document = await parse("/**\n * Doc.\n */\nsig A {\n  f: A\n}\nfact {\n  some A\n  no none\n}\n", nextUri());
        const ranges = await services.AlloyLsp.lsp.FoldingRangeProvider!.getFoldingRanges(document, { textDocument: { uri: document.uri.toString() } });
        expect(ranges.map(r => `${r.startLine + 1}-${r.endLine + 1}${r.kind ? ` ${r.kind}` : ""}`)).toEqual(
            expect.arrayContaining(["1-2 comment", "4-5", "7-9"]));
    });
});

describe("signature help", () => {
    test("shows the called pred and the argument the cursor is in, counting a receiver", async () => {
        const services = await alloyServices();
        const help = async (text: string) => {
            const { document, position } = await parseAt(text);
            return services.AlloyLsp.lsp.SignatureHelp!.provideSignatureHelp(document, { textDocument: { uri: document.uri.toString() }, position });
        };
        const model = "sig A {} sig B {}\npred link[a: A, b: B] {}\n";
        const direct = await help(`${model}fact { link[A, <|>B] }`);
        expect(direct?.signatures[0].label).toBe("pred link[a: A, b: B]");
        expect(direct?.signatures[0].parameters?.map(p => p.label)).toEqual(["a: A", "b: B"]);
        expect(direct?.activeParameter).toBe(1);
        const received = await help(`${model}fact { A.link[<|>B] }`);
        expect(received?.activeParameter).toBe(1);
    });
});

describe("rename", () => {
    test("renames across modules and keeps qualifiers", async () => {
        const services = await alloyServices();
        const lib = await parse("module graphs\nsig Node { next: lone Node }", "file:///editing/rename/graphs.als");
        const main = await parse("open graphs as g\nfact { some g/Node and Node in Node }", "file:///editing/rename/main.als");
        const edit = await services.AlloyLsp.lsp.RenameProvider!.rename(lib, {
            textDocument: { uri: lib.uri.toString() }, position: { line: 1, character: 5 }, newName: "Vertex"
        });
        expect(applied(lib.textDocument.getText(), edit!.changes![lib.uri.toString()])).toBe("module graphs\nsig Vertex { next: lone Vertex }");
        expect(applied(main.textDocument.getText(), edit!.changes![main.uri.toString()])).toBe("open graphs as g\nfact { some g/Vertex and Vertex in Vertex }");
    });

    test("refuses to rename a util library declaration", async () => {
        const services = await alloyServices();
        const { document, position } = await parseAt("open util/ordering[S]\nsig S {}\nfact { some fi<|>rst }");
        expect(await services.AlloyLsp.lsp.RenameProvider!.prepareRename(document, { textDocument: { uri: document.uri.toString() }, position })).toBeUndefined();
    });
});

describe("quick fixes", () => {
    /** The document's code actions at a position, given its linking errors. */
    async function actions(document: LangiumDocument, position: Position): Promise<CodeAction[]> {
        const services = await alloyServices();
        const diagnostics = (document.diagnostics ?? []).filter(d => d.data?.code === DocumentValidator.LinkingError) as Diagnostic[];
        return services.AlloyLsp.lsp.CodeActionProvider!.getCodeActions(document, {
            textDocument: { uri: document.uri.toString() }, range: { start: position, end: position }, context: { diagnostics }
        }) as Promise<CodeAction[]>;
    }

    /** Applies an action and re-validates the result, returning its new text and remaining errors. */
    async function apply(document: LangiumDocument, action: CodeAction): Promise<{ text: string, errors: string[] }> {
        const text = applied(document.textDocument.getText(), action.edit!.changes![document.uri.toString()]);
        const fixed = await parse(text, nextUri("fixed"));
        return { text, errors: (fixed.diagnostics ?? []).filter(d => d.severity === 1).map(d => String(d.message)) };
    }

    test("opens the util module that declares an unresolved name", async () => {
        const { document, position } = await parseAt("sig S {}\nfact { some <|>first }");
        const open = (await actions(document, position)).find(a => a.title.startsWith("Add 'open"));
        expect(open?.title).toBe("Add 'open util/ordering[univ]'");
        const result = await apply(document, open!);
        expect(result.text).toBe("open util/ordering[univ]\nsig S {}\nfact { some first }");
        expect(result.errors).toEqual([]);
    });

    test("creates a pred for an unresolved call", async () => {
        const { document, position } = await parseAt("sig A {}\nfact { <|>reachable[A, A] }");
        const stub = (await actions(document, position)).find(a => a.title === "Create 'pred reachable'");
        const result = await apply(document, stub!);
        expect(result.text).toBe("sig A {}\nfact { reachable[A, A] }\npred reachable[p1, p2: univ] {\n}\n");
        expect(result.errors).toEqual([]);
    });

    test("adds a check for an assertion nothing checks, and not for one already checked", async () => {
        const { document, position } = await parseAt("assert <|>ok { no none }");
        const check = (await actions(document, position)).find(a => a.title === "Add 'check ok'");
        const result = await apply(document, check!);
        expect(result.text).toBe("assert ok { no none }\ncheck ok\n");
        expect(result.errors).toEqual([]);
        const checked = await parseAt("assert <|>ok { no none }\ncheck ok");
        expect((await actions(checked.document, checked.position)).map(a => a.title)).toEqual([]);
    });
});

describe("inlay hints", () => {
    test("show the types of let bindings, and can be turned off", async () => {
        const services = await alloyServices();
        const document = await parse("sig A { r: A }\nfact { let x = A.r | some x }\nfact { let y = A, z = A -> A | some y.z }", nextUri());
        const params = { textDocument: { uri: document.uri.toString() }, range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } } };
        const hints = await services.AlloyLsp.lsp.InlayHintProvider!.getInlayHints(document, params);
        expect(hints?.map(h => `${h.position.line + 1}:${h.position.character + 1}${h.label}`)).toEqual(["2:13: A", "3:13: A", "3:20: A->A"]);
        services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { "alloy-lsp": { inlayHints: { enabled: false } } } });
        expect(await services.AlloyLsp.lsp.InlayHintProvider!.getInlayHints(document, params)).toEqual([]);
        services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { "alloy-lsp": { inlayHints: { enabled: true } } } });
    });
});
