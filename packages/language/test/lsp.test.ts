import { describe, expect, test } from "vitest";
import type { LangiumDocument } from "langium";
import type { CompletionItem, DocumentSymbol, Position } from "vscode-languageserver";
import { alloyServices, parse } from "./helpers.js";

let counter = 0;

/** Parses `text` with `<|>` marking one position, and returns the document and that position. */
async function parseAt(text: string, uri = `file:///lsp/model${++counter}.als`): Promise<{ document: LangiumDocument, position: Position }> {
    const offset = text.indexOf("<|>");
    const document = await parse(text.slice(0, offset) + text.slice(offset + 3), uri);
    return { document, position: document.textDocument.positionAt(offset) };
}

async function definitionAt(text: string, uri?: string): Promise<string[]> {
    const services = await alloyServices();
    const { document, position } = await parseAt(text, uri);
    const links = await services.AlloyLsp.lsp.DefinitionProvider!.getDefinition(document, { textDocument: { uri: document.uri.toString() }, position });
    return (links ?? []).map(link => `${link.targetUri}:${link.targetSelectionRange.start.line + 1}`);
}

async function hoverAt(text: string): Promise<string> {
    const services = await alloyServices();
    const { document, position } = await parseAt(text);
    const hover = await services.AlloyLsp.lsp.HoverProvider!.getHoverContent(document, { textDocument: { uri: document.uri.toString() }, position });
    return hover && typeof hover.contents === "object" && "value" in hover.contents ? hover.contents.value : "";
}

async function completionsAt(text: string): Promise<CompletionItem[]> {
    const services = await alloyServices();
    const { document, position } = await parseAt(text);
    const list = await services.AlloyLsp.lsp.CompletionProvider!.getCompletion(document, { textDocument: { uri: document.uri.toString() }, position });
    return list?.items ?? [];
}

function outline(symbols: DocumentSymbol[], indent = ""): string[] {
    return symbols.flatMap(s => [`${indent}${s.name}${s.detail ? ` (${s.detail})` : ""}`, ...outline(s.children ?? [], indent + "  ")]);
}

describe("go to definition", () => {
    test("a field use leads to the field", async () => {
        expect(await definitionAt("sig A { f: A }\nfact { some A.<|>f }", "file:///lsp/def-field.als"))
            .toEqual(["file:///lsp/def-field.als:1"]);
    });

    test("a name from another workspace module leads into that module", async () => {
        await parse("module shapes\nsig Shape {}", "file:///lsp/ws/shapes.als");
        expect(await definitionAt("open shapes\nfact { some Sha<|>pe }", "file:///lsp/ws/main.als"))
            .toEqual(["file:///lsp/ws/shapes.als:2"]);
    });

    test("a util function leads into the bundled library", async () => {
        const [target] = await definitionAt("open util/ordering[S]\nsig S {}\nfact { some fir<|>st }");
        expect(target).toMatch(/^alloy-lib:\/util\/ordering\.als:\d+$/);
    });

    test("an open path leads to the module it names", async () => {
        expect(await definitionAt("open util/ord<|>ering[S]\nsig S {}")).toEqual(["alloy-lib:/util/ordering.als:1"]);
    });
});

describe("find references", () => {
    test("finds uses of a sig in its own module and in a module that opens it", async () => {
        const services = await alloyServices();
        const lib = await parse("module lib\nsig Node { next: lone Node }", "file:///lsp/refs/lib.als");
        await parse("open lib\nfact { some Node }", "file:///lsp/refs/main.als");
        const references = await services.AlloyLsp.lsp.ReferencesProvider!.findReferences(lib, {
            textDocument: { uri: lib.uri.toString() }, position: { line: 1, character: 5 }, context: { includeDeclaration: false }
        });
        expect(references.map(r => `${r.uri}:${r.range.start.line + 1}:${r.range.start.character + 1}`).sort()).toEqual([
            "file:///lsp/refs/lib.als:2:23",
            "file:///lsp/refs/main.als:2:13"
        ]);
    });
});

describe("symbols", () => {
    test("the outline lists sigs with their fields, enums with members, and every paragraph", async () => {
        const services = await alloyServices();
        const document = await parse(`
            abstract sig Person { friends: set Person }
            sig Student, Teacher extends Person { grade: Int }
            enum Day { Mon, Tue }
            fact noSelf { no iden & friends }
            pred lonely[p: Person] { no p.friends }
            fun pals[p: Person] : set Person { p.friends }
            assert symmetric { friends = ~friends }
            run lonely for 3
            check symmetric
        `, "file:///lsp/outline.als");
        const symbols = await services.AlloyLsp.lsp.DocumentSymbolProvider!.getSymbols(document, { textDocument: { uri: document.uri.toString() } });
        expect(outline(symbols)).toEqual([
            "Person", "  friends (set Person)",
            "Student (extends Person)", "  grade (Int)",
            "Teacher (extends Person)", "  grade (Int)",
            "Day", "  Mon", "  Tue",
            "noSelf", "lonely", "pals", "symmetric",
            "run lonely", "check symmetric"
        ]);
    });

    test("workspace symbols include the util library's public declarations", async () => {
        const services = await alloyServices();
        const symbols = await services.shared.lsp.WorkspaceSymbolProvider!.getSymbols({ query: "acyclic" });
        expect(symbols.map(s => `${s.name} @ ${s.location.uri}`)).toContain("acyclic @ alloy-lib:/util/relation.als");
    });
});

describe("hover", () => {
    test("a field shows its declaration, inferred type, module and doc comment", async () => {
        const text = await hoverAt(`
            module family
            sig Person {
                /** Who this person's parents are. */
                parents: set Person
            }
            fact { no p: Person | p in p.^pa<|>rents }
        `);
        expect(text).toContain("Person.parents: set Person");
        expect(text).toContain("type: `Person->Person`");
        expect(text).toContain("module `family`");
        expect(text).toContain("Who this person's parents are.");
    });

    test("a pred call shows the pred's header", async () => {
        expect(await hoverAt("sig A {}\npred big[a: A] { some a }\nfact { b<|>ig[A] }")).toContain("pred big[a: A]");
    });

    test("a util function shows where it comes from and its documentation", async () => {
        const text = await hoverAt("open util/ordering[S]\nsig S {}\nfact { some fi<|>rst }");
        expect(text).toContain("fun first: one elem");
        expect(text).toContain("module `util/ordering`");
        expect(text).toMatch(/first/i);
    });
});

describe("completion", () => {
    test("after a dot, only fields the left side can join with are offered", async () => {
        const labels = (await completionsAt(`
            sig A { af: A } sig B { bf: B }
            fact { all a: A | some a.<|> }
        `)).map(i => i.label);
        expect(labels).toContain("af");
        expect(labels).not.toContain("bf");
    });

    test("a type scope offers sigs and not preds", async () => {
        const labels = (await completionsAt("sig A {} sig B {} pred p {}\nrun p for 3 but 2 <|>")).map(i => i.label);
        expect(labels).toEqual(expect.arrayContaining(["A", "B"]));
        expect(labels).not.toContain("p");
    });

    test("paragraph keywords come with snippets", async () => {
        const items = await completionsAt("sig A {}\n<|>");
        const snippets = items.filter(i => i.label.endsWith(" …")).map(i => i.label);
        expect(snippets).toEqual(expect.arrayContaining(["sig …", "pred …", "fun …", "fact …", "assert …", "run …", "check …"]));
    });
});
