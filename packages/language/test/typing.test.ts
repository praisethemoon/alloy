import { describe, expect, test } from "vitest";
import { AstUtils, type Reference } from "langium";
import { isDeclName, isFactDecl, typeToString } from "alloy-lsp-language";
import { alloyServices, parse } from "./helpers.js";

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

const sigs = "sig A { r: A } sig B { s: B } sig C extends A {}";

// [what, model with the problem, the diagnostic, the same model made valid]
const cases: Array<[string, string, string | string[], string]> = [
    ["a formula is expected", `${sigs} fact { A }`,
        "error: This must be a formula, but it is an expression of type A.", `${sigs} fact { some A }`],
    ["an expression is expected", `${sigs} fact { some (A in A) }`,
        "error: This must be a set, relation or integer expression, but it is a formula.", `${sigs} fact { some A }`],
    ["union of unequal arities", `${sigs} fact { some A + r }`,
        "error: + needs operands of the same arity, but the left side has arity 1 and the right side 2.", `${sigs} fact { some A + A.r }`],
    ["intersection of unequal arities", `${sigs} fact { some A & r }`,
        "error: & needs operands of the same arity, but the left side has arity 1 and the right side 2.", `${sigs} fact { some A & C }`],
    ["override of unequal arities", `${sigs} fact { some r ++ A }`,
        "error: ++ needs operands of the same arity, but the left side has arity 2 and the right side 1.", `${sigs} fact { some r ++ r }`],
    ["comparison of unequal arities", `${sigs} fact { A in r }`,
        "error: in needs operands of the same arity, but the left side has arity 1 and the right side 2.", `${sigs} fact { A in A.r }`],
    ["closure of a set", `${sigs} fact { some ^A }`,
        "error: ^ needs a binary relation, but its operand has arity 1.", `${sigs} fact { some ^r }`],
    ["transpose of a set", `${sigs} fact { some ~A }`,
        "error: ~ needs a binary relation, but its operand has arity 1.", `${sigs} fact { some ~r }`],
    ["domain restriction by a relation", `${sigs} fact { some r <: r }`,
        "error: The left side of <: must be a set, but it has arity 2.", `${sigs} fact { some A <: r }`],
    ["range restriction by a relation", `${sigs} fact { some r :> r }`,
        "error: The right side of :> must be a set, but it has arity 2.", `${sigs} fact { some r :> A }`],
    ["join of two sets", `${sigs} fact { some A.A }`,
        "error: A join needs a relation on at least one side, but both sides are sets (A and A).", `${sigs} fact { some A.r }`],
    ["always-empty join", `${sigs} fact { some B.r }`,
        "warning: This join is always empty: no column of B meets A->A.", `${sigs} fact { some C.r }`],
    ["always-empty intersection", `${sigs} fact { some A & B }`,
        "warning: This intersection is always empty: A and B are disjoint.", `${sigs} fact { some A & C }`],
    ["always-empty restriction", `${sigs} fact { some B <: r }`,
        "warning: This restriction is always empty: B is disjoint from the domain of A->A.", `${sigs} fact { some C <: r }`],
    ["override of disjoint relations", `${sigs} fact { some r ++ s }`,
        "warning: A->A and B->B never overlap, so ++ is just a union here.", `${sigs} fact { some r ++ (C -> A) }`],
    ["a duplicate module-level name", "sig A {} pred A {}",
        "error: 'A' is already declared in this module (line 1).", "sig A {} pred p[a: A] {} pred p {}"],
    ["a field repeated in one sig", "sig A { f: A, f: A }",
        "error: Field 'f' is already declared in this sig (line 1).", "sig A { f: A, g: A }"],
    ["a field clashing with an ancestor's", "sig A { f: A } sig B extends A { f: A }",
        "error: Field 'f' clashes with the field of that name in 'A', which this sig extends.", "sig A { f: A } sig B { f: B }"],
    ["cyclic extends", "sig A extends B {} sig B extends A {}",
        ["error: 'A' extends itself through 'B'.", "error: 'B' extends itself through 'A'."], "sig A extends B {} sig B {}"],
    ["extending a subset sig", "sig A {} sig S in A {} sig T extends S {}",
        "error: 'S' is a subset sig (declared with in or =), and only sigs declared with extends or at the top can be extended.", "sig A {} sig S in A {} sig T extends A {}"],
    ["var outside a sig field", "fact { all var x: univ | some x }",
        "error: 'var' can only mark sig fields; parameters and bound variables are not mutable.", "sig A { var f: A }"],
    ["a variable declared twice by one binder", "fact { all x: univ, x: univ | some x }",
        "error: 'x' is declared twice here.", "fact { all x: univ, y: univ | some x + y }"],
    ["a repeated sig qualifier", "abstract abstract sig A {}",
        "error: 'abstract' is given 2 times.", "abstract sig A {}"],
    ["two sig multiplicities", "lone one sig A {}",
        "error: A sig takes at most one multiplicity, but lone and one are given.", "lone sig A {}"],
    ["an empty string", 'fact { "" in String }',
        "error: An empty string is not allowed; use an empty set (none) instead.", 'fact { "a" in String }'],
    ["a dollar sign in a name", "sig A$1 {}",
        "error: 'A$1': names cannot contain '$', which the Analyzer reserves for its own.", "sig A1 {}"]
];

describe("each diagnostic, and the valid model next to it", () => {
    test.each(cases)("%s", async (_what, invalid, diagnostic, valid) => {
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
});
