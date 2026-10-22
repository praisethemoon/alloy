import { describe, expect, test } from "vitest";
import { AstUtils, type Reference } from "langium";
import { isDeclName, isFactDecl, typeToString } from "alloy-lsp-language";
import { alloyServices, parse } from "./helpers.js";
import { typingCases } from "./cases/typing-cases.js";

let counter = 0;

/** The model's Alloy diagnostics (no syntax errors), as `error: message` or `warning: message`. */
async function diagnostics(text: string): Promise<string[]> {
    const document = await parse(text, `file:///typing/model${++counter}.als`);
    return (document.diagnostics ?? [])
        .filter(d => d.data?.code !== "lexing-error" && d.data?.code !== "parsing-error")
        .map(d => `${d.severity === 1 ? "error" : "warning"}: ${typeof d.message === "string" ? d.message : d.message.value}`);
}

/** The inferred type of each formula's operand in the model's last fact, printed. */
async function typesInLastFact(text: string): Promise<string[]> {
    const services = await alloyServices();
    const document = await parse(text, `file:///typing/types${++counter}.als`);
    const facts = document.parseResult.value.paragraphs.filter(isFactDecl);
    const fact = facts[facts.length - 1];
    const isTest = (e: typeof fact.body.exprs[number]) => e.$type === "UnaryExpr" && ["some", "no", "lone", "one"].includes(e.op);
    return fact.body.exprs.map(e => typeToString(services.AlloyLsp.typing.TypeSystem.typeOf(isTest(e) ? (e as { operand: typeof e }).operand : e)));
}

describe("each diagnostic, and the valid model next to it", () => {
    test.each(typingCases)("%s", async (_what, invalid, diagnostic, valid) => {
        expect(await diagnostics(invalid)).toEqual([diagnostic].flat());
        expect(await diagnostics(valid)).toEqual([]);
    });
});

describe("inferred types", () => {
    test("joins, products, closures, restrictions and subset sigs", async () => {
        expect(await typesInLastFact(`
            sig A { r: A -> B } sig B {} sig S in A + B {}
            fact {
                some A.r
                some r.B
                some A -> B
                some ^(A.r.B -> A)
                some ~(A <: r.B)
                some S
                some {a: A, b: B | b in a.r[A]}
                some iden
            }
        `)).toEqual(["A->B", "A->A", "A->B", "A->A", "A->A", "A + B", "A->B", "univ->univ"]);
    });

    test("integers, calls and implicit this in signature facts", async () => {
        expect(await typesInLastFact(`
            sig A { r: A }
            fun f[x: A] : set A { x.r }
            pred p[x: A] { some x }
            fact { #A = 3 }
            fact {
                f[A]
                A.f
                #A
                Int[#A]
            }
        `)).toEqual(["A", "A", "Int", "Int"]);
    });
});

describe("overloaded fields", () => {
    test("resolve by the type of the left side of a dot, and by the enclosing signature fact", async () => {
        const document = await parse(`
            sig A { f: A } sig B { f: B }
            fact { all a: A, b: B | some a.f and some b.f }
            sig C extends B {} { some f }
        `, "file:///typing/overloads.als");
        expect((document.diagnostics ?? []).filter(d => d.severity === 1)).toEqual([]);
        const owners = AstUtils.streamAst(document.parseResult.value)
            .flatMap(node => AstUtils.streamReferences(node))
            .map(({ reference }) => reference as Reference)
            .filter(reference => reference.$refText === "f")
            .map(reference => isDeclName(reference.ref) && reference.ref.$container.$container.$type === "SigDecl"
                ? (reference.ref.$container.$container as { names: Array<{ name: string }> }).names[0].name : "?")
            .toArray();
        expect(owners).toEqual(["A", "B", "B"]);
    });

    test("resolve by the set a restriction keeps, on either side", async () => {
        const document = await parse(`
            sig S {} sig X {} sig Y {}
            sig A extends S { d: X } sig B extends S { d: Y }
            fact { all s: S | some s.(B <: d) and some s.(A <: d) and some (d :> Y) }
        `, "file:///typing/restrictions.als");
        expect((document.diagnostics ?? []).filter(d => d.severity === 1)).toEqual([]);
        expect(fieldOwners(document, "d")).toEqual(["B", "A", "B"]);
    });

    test("a field, not a parameterless pred of the same name, where only a relation fits", async () => {
        const document = await parse(`
            sig N { init: set N }
            pred init { some N }
            fact { some N.init and some N.(N <: init) and init }
        `, "file:///typing/field-or-pred.als");
        expect((document.diagnostics ?? []).filter(d => d.severity === 1)).toEqual([]);
        expect(fieldOwners(document, "init")).toEqual(["N", "N", "?"]);
    });
});

describe("fields of subset sigs", () => {
    test("have their parents' type as their domain", async () => {
        expect(await diagnostics(`
            sig S {} sig T in S { r: set S }
            fact { all s: S | some s.r and some r.S }
        `)).toEqual([]);
        expect(await typesInLastFact(`
            sig S {} sig U {} sig T in S + U { r: set S }
            fact { some r }
        `)).toEqual(["S->S + U->S"]);
    });
});

/** The sig owning each field that references named `name` resolve to, in document order; "?" for anything else. */
function fieldOwners(document: Awaited<ReturnType<typeof parse>>, name: string): string[] {
    return AstUtils.streamAst(document.parseResult.value)
        .flatMap(node => AstUtils.streamReferences(node))
        .map(({ reference }) => reference as Reference)
        .filter(reference => reference.$refText === name)
        .map(reference => isDeclName(reference.ref) && reference.ref.$container.$container.$type === "SigDecl"
            ? (reference.ref.$container.$container as { names: Array<{ name: string }> }).names[0].name : "?")
        .toArray();
}
