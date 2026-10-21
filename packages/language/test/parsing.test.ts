import { describe, expect, test } from "vitest";
import { isCommand, isFunDecl, isSigDecl, utilLibrary, type CommandCall, type SigDecl } from "alloy-lsp-language";
import { parse, showDecl, show, syntaxErrors } from "./helpers.js";
import { validSyntax } from "./cases/syntax-cases.js";

describe("the Alloy util library", () => {
    const modules = Object.keys(utilLibrary).sort();

    test("has all 11 modules", () => {
        expect(modules).toHaveLength(11);
    });

    test.each(modules)("%s parses without errors", async module => {
        const document = await parse(utilLibrary[module]);
        expect(syntaxErrors(document)).toEqual([]);
    });
});

describe("valid Alloy syntax", () => {
    test.each(validSyntax)("%s", async (_name, text) => {
        const document = await parse(text);
        expect(syntaxErrors(document)).toEqual([]);
    });
});

describe("declaration shapes", () => {
    async function sig(text: string): Promise<SigDecl> {
        const document = await parse(text);
        expect(syntaxErrors(document)).toEqual([]);
        const paragraph = document.parseResult.value.paragraphs[0];
        if (!isSigDecl(paragraph)) throw new Error(`expected a sig, got ${paragraph?.$type}`);
        return paragraph;
    }

    async function commandCalls(text: string): Promise<CommandCall[]> {
        const document = await parse(text);
        expect(syntaxErrors(document)).toEqual([]);
        const paragraph = document.parseResult.value.paragraphs[0];
        if (!isCommand(paragraph)) throw new Error(`expected a command, got ${paragraph?.$type}`);
        return paragraph.calls;
    }

    test("a sig keeps its qualifiers, names, parent and fields", async () => {
        const s = await sig("abstract var sig A, B extends C { f: lone D, disj g, h: set E }");
        expect([s.abstract, s.var, s.private, s.multiplicity]).toEqual([true, true, false, undefined]);
        expect(s.names.map(n => n.name)).toEqual(["A", "B"]);
        expect(s.extends?.ref?.$refText).toBe("C");
        expect(s.fields.map(showDecl)).toEqual(["f: (lone D)", "disj g, h: (set E)"]);
    });

    test("a subset sig keeps every parent", async () => {
        const s = await sig("one sig A in B + C {}");
        expect(s.multiplicity).toBe("one");
        expect(s.in.map(r => r.ref?.$refText)).toEqual(["B", "C"]);
    });

    test("a multiplicity right after ':' is not read as a quantifier", async () => {
        const s = await sig("sig A { f: some B, g: C }");
        expect(s.fields.map(showDecl)).toEqual(["f: (some B)", "g: C"]);
    });

    test("a receiver fun keeps its receiver, parameters and return type", async () => {
        const document = await parse("fun A.f[x: B] : set C { x }");
        expect(syntaxErrors(document)).toEqual([]);
        const f = document.parseResult.value.paragraphs[0];
        if (!isFunDecl(f)) throw new Error("expected a fun");
        expect([f.receiver?.ref?.$refText, f.name, f.params.map(showDecl), show(f.returnType)])
            .toEqual(["A", "f", ["x: B"], "(set C)"]);
    });

    test("command forms say what is run, under which label", async () => {
        const [[byName], [byBlock], [labelled], [labelAndTarget]] = await Promise.all([
            commandCalls("run show for 3"),
            commandCalls("check named { no none }"),
            commandCalls("lbl: check A"),
            commandCalls("run lbl show")
        ]);
        expect([byName.kind, byName.name, byName.target?.$refText, byName.scope?.overall]).toEqual(["run", undefined, "show", 3]);
        expect([byBlock.kind, byBlock.name, byBlock.body?.$type]).toEqual(["check", "named", "Block"]);
        expect((labelled.$container as { label?: string }).label).toBe("lbl");
        expect([labelAndTarget.name, labelAndTarget.target?.$refText]).toEqual(["lbl", "show"]);
    });

    test("type scopes keep exactly, ranges, increments and targets", async () => {
        const [call] = await commandCalls("run p for 3 but exactly 2..8:2 A, 1.. steps, 5 Int");
        expect(call.scope?.typeScopes.map(t => [t.exactly, t.start, t.range, t.end, t.increment, t.builtin ?? t.sig?.$refText]))
            .toEqual([
                [true, 2, true, 8, 2, "A"],
                [false, 1, true, undefined, undefined, "steps"],
                [false, 5, false, undefined, undefined, "Int"]
            ]);
    });

    test("numbers in every base read as their values", async () => {
        const [call] = await commandCalls("run p for 0x_10 but 0b1_01 A, 1000 B");
        expect([call.scope?.overall, ...(call.scope?.typeScopes.map(t => t.start) ?? [])]).toEqual([16, 5, 1000]);
    });
});
