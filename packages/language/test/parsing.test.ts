import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isCommand, isFunDecl, isSigDecl, type CommandCall, type SigDecl } from "alloy-lsp-language";
import { parse, showDecl, show, syntaxErrors } from "./helpers.js";

const utilDir = path.join(__dirname, "fixtures", "util");

describe("the Alloy util library", () => {
    const files = fs.readdirSync(utilDir).filter(f => f.endsWith(".als")).sort();

    test("has all 11 modules", () => {
        expect(files).toHaveLength(11);
    });

    test.each(files)("%s parses without errors", async file => {
        const document = await parse(fs.readFileSync(path.join(utilDir, file), "utf-8"));
        expect(syntaxErrors(document)).toEqual([]);
    });
});

// One case per production group of Alloy.cup, named after its nonterminal.
const validSyntax: Array<[string, string]> = [
    // Spec
    ["module header", "module a/b/c"],
    ["module with parameters", "module util/ordering[exactly elem, other]"],
    ["open", "open util/ordering"],
    ["private open with arguments and alias", "private open util/ordering[State, univ, Int, seq/Int] as so"],
    ["open with empty arguments", "open m[]"],
    ["enum", "enum Color { Red, Green, Blue }"],
    ["private empty enum", "private enum E {}"],
    ["anonymous fact", "fact { no none }"],
    ["named fact", "fact acyclic { no iden & ^next }"],
    ["fact labelled with a string", 'fact "no self loops" { no iden & next }'],
    ["named and anonymous asserts", 'assert A { some univ } assert { no none } assert "s" {}'],
    // Command, Scope, Typescope, TypeNumber, Expects
    ["run a predicate", "run show"],
    ["check with an overall scope", "check A for 3"],
    ["run with but", "run show for 3 but 2 A, exactly 4 B, 5 Int, 4 int, 3 seq"],
    ["run with type scopes only", "run show for 2 A, 3 univ, 1 String, 0 none"],
    ["inline command block", "run { some univ } for 4 expect 1"],
    ["named command block", "run nonEmpty { some univ } expect 0"],
    ["labelled command", "pos: run show for 3"],
    ["command naming a label and a target", "run myLabel show for 3"],
    ["chained commands", "run a for 2 => check b for 3"],
    ["step scopes", "run show for 3 but 1..10 steps"],
    ["open-ended step scope", "run show for 3 but 1.. steps"],
    ["exact ranges and increments", "run show for exactly 2..8:2 A, 3:1 B"],
    ["qualified scope target", "run show for 2 this/A, 3 m/B"],
    // Macro
    ["macro with parenthesised parameters", "let m(a, b) { a = b }"],
    ["macro with bracketed parameters", "private let m[a] = a + a"],
    ["macro without parameters", "let m = univ"],
    ["macro with empty parameters", "let m[] { none }"],
    // Function, Predicate
    ["fun with bracketed parameters", "fun f[x: A, y: B] : set A { x + y }"],
    ["fun with parenthesised parameters", "fun f(x: A) : A { x }"],
    ["fun without parameters", "private fun f : A -> B { A -> B }"],
    ["receiver fun", "fun A.f[y: B] : B { this.r & y }"],
    ["receiver fun on a builtin sig", "fun univ.f : univ { this }"],
    ["pred", "pred p[x, y: A] { x = y }"],
    ["pred without parameters", "pred p { }"],
    ["receiver pred", "pred A.p { some this }"],
    ["stray commas in parameters", "pred p[, x: A,, y: B,] {}"],
    ["parameter declarations with =, disj and private", "pred p[disj a, b: A, c = d, private e: disj E] {}"],
    // Sig, SigQual, SigIn, SigRef
    ["empty sig", "sig A {}"],
    ["several sigs at once", "sig A, B, C {}"],
    ["qualified sig", "abstract lone sig A extends B {}"],
    ["qualifiers in any order", "private one var sig A {}"],
    ["some sig", "some sig A {}"],
    ["subset sig of a union", "sig A in B + C + univ {}"],
    ["sig defined by =", "sig A = B + C {}"],
    ["extending a builtin", "sig A extends Int {}"],
    ["fields", "sig A { f: B, g: lone C, h: set D, i: A -> lone B }"],
    ["field forms", "sig A { var f: B, disj g, h: C, private i: disj D, j = k, var private disj l: E }"],
    ["stray commas in fields", "sig A { , f: B,, g: C, }"],
    ["signature fact", "sig A { f: B } { some f }"],
    ["empty signature fact", "sig A {} {}"],
    // Name
    ["this/ and seq/ names", "fact { this/A in seq/Int + this/x/y }"],
    // Expressions: atoms (BaseExpr)
    ["numbers", "fact { 0 + 12 + 1_000 + 0x1F + 0x_FF + 0b1011 + -3 = 0 }"],
    ["string", 'fact { "hello" in String }'],
    ["constants", "fact { iden + univ + none + Int + String + steps + this in univ -> univ }"],
    ["integer builtins", "fact { fun/min < fun/max and fun/next = fun/next }"],
    ["@ name", "sig A { f: A } { @f = f }"],
    ["parentheses", "fact { (a + b).c = d }"],
    ["nested block", "fact { { a b } }"],
    // Comprehension, Let, quantifiers (Bind)
    ["comprehension", "fact { {x: A | some x.f} in A }"],
    ["comprehension with block body", "fact { {x: A, y: B { x = y }} in A -> B }"],
    ["comprehension without body", "fact { {x: A} = A }"],
    ["let", "fact { let a = b, c = d | a = c }"],
    ["let with block body", "fact { let a = b { a = b } }"],
    ["quantifiers", "fact { all x: A | no y: B | lone z: C | one w: D | some v: E | v = w }"],
    ["quantifier with disj and block", "fact { all disj x, y: A, z: B { x != y } }"],
    ["sum quantifier", "fact { (sum x: A | #x) = 3 }"],
    ["quantifier with = declarations", "fact { some x = A | x = A }"],
    // Operators
    ["logical keywords and symbols", "fact { a and b && c or d || e implies f => g iff h <=> i }"],
    ["implies else", "fact { a => b else c }"],
    ["negations", "fact { not a !b }"],
    ["comparisons", "fact { a in b a = b a < b a > b a =< b a <= b a >= b }"],
    ["negated comparisons", "fact { a !in b a != b a not in b a not = b a !< b a !> b a !=< b a !>= b }"],
    ["multiplicity tests", "fact { no a some b lone c one d }"],
    ["set and seq", "fun f : set A { A } fun g : seq A { none }"],
    ["shifts", "fact { a << b >> c >>> d = e }"],
    ["union, difference, override, intersection", "fact { a + b - c ++ d & e = f }"],
    ["integer operators", "fact { a fun/add b fun/sub c fun/mul d fun/div e fun/rem f = g }"],
    ["cardinality and casts", "fact { #a = sum b and int c = 1 and int[d] = 1 and e.int = 1 and sum[f] = 1 }"],
    ["arrow multiplicities", "fact { a -> b a some -> one b a lone -> some b a one -> lone b a set -> set b a -> lone b }"],
    ["restrictions", "fact { a <: b :> c = d }"],
    ["joins", "fact { a.b.c = d::e }"],
    ["box joins", "fact { a[b][c, d] = e[] }"],
    ["closures and transpose", "fact { ~a + ^b + *c in d }"],
    ["disj and totalOrder", "fact { disj[a, b] and pred/totalOrder[a, b, c] and a.disj and a.pred/totalOrder }"],
    // Alloy 6
    ["var sig and fields", "var sig A { var f: B }"],
    ["primes", "fact { a' = b.c' and (a.b)' = d‘ and e’ = f }"],
    ["future temporal operators", "fact { always a eventually b after c a until b a releases b }"],
    ["past temporal operators", "fact { historically a once b before c a since b a triggered b }"],
    ["sequencing", "fact { a ; b ; c }"],
    ["sequencing inside a quantifier body", "fact { all x: A | a ; b }"],
    // Lexer
    ["all three comment styles", "// line\n-- line\n/* block */ /** doc */ sig A {}"],
    ["comment at the end of the file without a newline", "sig A {} // done"],
    ["identifiers with $, \" and unicode", 'sig A$1, B", Ünïcødé {}'],
    ["keyword prefixes are identifiers", "sig funny, predicate, allx, Integer {} fun add[n: Int] : Int { n }"]
];

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
        expect(s.extends?.name).toBe("C");
        expect(s.fields.map(showDecl)).toEqual(["f: (lone D)", "disj g, h: (set E)"]);
    });

    test("a subset sig keeps every parent", async () => {
        const s = await sig("one sig A in B + C {}");
        expect(s.multiplicity).toBe("one");
        expect(s.in.map(r => r.name)).toEqual(["B", "C"]);
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
        expect([f.receiver?.name, f.name, f.params.map(showDecl), show(f.returnType)])
            .toEqual(["A", "f", ["x: B"], "(set C)"]);
    });

    test("command forms say what is run, under which label", async () => {
        const [[byName], [byBlock], [labelled], [labelAndTarget]] = await Promise.all([
            commandCalls("run show for 3"),
            commandCalls("check named { no none }"),
            commandCalls("lbl: check A"),
            commandCalls("run lbl show")
        ]);
        expect([byName.kind, byName.name, byName.scope?.overall]).toEqual(["run", "show", 3]);
        expect([byBlock.kind, byBlock.name, byBlock.body?.$type]).toEqual(["check", "named", "Block"]);
        expect((labelled.$container as { label?: string }).label).toBe("lbl");
        expect([labelAndTarget.name, labelAndTarget.target]).toEqual(["lbl", "show"]);
    });

    test("type scopes keep exactly, ranges, increments and targets", async () => {
        const [call] = await commandCalls("run p for 3 but exactly 2..8:2 A, 1.. steps, 5 Int");
        expect(call.scope?.typeScopes.map(t => [t.exactly, t.start, t.range, t.end, t.increment, t.target]))
            .toEqual([
                [true, 2, true, 8, 2, "A"],
                [false, 1, true, undefined, undefined, "steps"],
                [false, 5, false, undefined, undefined, "Int"]
            ]);
    });

    test("numbers in every base read as their values", async () => {
        const [call] = await commandCalls("run p for 0x10 but 0b101 A, 1_000 B");
        expect([call.scope?.overall, ...(call.scope?.typeScopes.map(t => t.start) ?? [])]).toEqual([16, 5, 1000]);
    });
});
