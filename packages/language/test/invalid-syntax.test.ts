import { describe, expect, test } from "vitest";
import { parse, syntaxErrors } from "./helpers.js";

// Inputs Alloy.cup / Alloy.lex reject; each must give at least one error.
const invalidSyntax: Array<[string, string]> = [
    // Spec
    ["module without a name", "module"],
    ["open without a path", "open"],
    ["open with an empty alias", "open util/ordering as"],
    ["enum members without commas", "enum E { A B }"],
    ["a fact with two names", "fact a b {}"],
    ["a fact without a body", "fact a"],
    ["private fact", "private fact {}"],
    ["qualifier on a fact", "abstract fact {}"],
    ["var pred", "var pred p {}"],
    // Sig
    ["sig without a name", "sig {}"],
    ["sig without a body", "sig A"],
    ["sig name starting with a digit", "sig 1A {}"],
    ["extends with a union", "sig A extends B + C {}"],
    ["extends without a parent", "sig A extends {}"],
    ["qualifier after sig", "sig abstract A {}"],
    ["field without a type", "sig A { f }"],
    ["fields without a comma", "sig A { f: B g: C }"],
    ["field with a missing name", "sig A { : B }"],
    // Function, Predicate, Macro
    ["fun without a return type", "fun f[x: A] { x }"],
    ["fun without a body", "fun f : A"],
    ["unclosed parameter list", "pred p[x: A { }"],
    ["parameter without a type", "pred p[x: A, y] {}"],
    ["mismatched parameter brackets", "pred p[x: A) {}"],
    ["macro parameters without commas", "let m(a b) = a"],
    ["macro without a body", "let m"],
    // Command, Scope
    ["bare run", "run"],
    ["run with only a scope", "run for 3"],
    ["for without a number", "check A for"],
    ["but without scopes", "run A for 3 but"],
    ["type scope without a sig", "run A for 3 but 2"],
    ["exactly without a sig", "run A for exactly 3"],
    ["expect without a number", "run A expect"],
    ["exactly on the overall scope", "run A for exactly 3 but 2 B"],
    ["label without a command", "lbl:"],
    // Expressions
    ["missing right operand", "fact { a and }"],
    ["double arrow", "fact { a -> -> b }"],
    ["quantifier without a bound", "fact { all x | p }"],
    ["quantifier without a body", "fact { all x: A }"],
    ["let without a value", "fact { let x | x }"],
    ["unbalanced parenthesis", "fact { (a + b }"],
    ["unclosed box join", "fact { a[b }"],
    ["join without a right side", "fact { a. }"],
    ["unary minus on a non-number", "fact { -a = b }"],
    ["unknown fun/ operator", "fact { a fun/foo b }"],
    ["multiplicity on the right of in", "fact { a in no b }"],
    ["prime before an operand", "fact { a = 'b }"],
    ["temporal operator without an operand", "fact { always }"],
    ["binary temporal operator without a right side", "fact { a until }"],
    ["sequencing without a right side", "fact { a ; }"],
    ["arrow without a right side", "fact { a -> lone }"],
    ["comparison operator alone", "fact { in b }"],
    ["unclosed block", "fact { a"],
    // Lexer
    ["unterminated string", 'fact { "abc = a }'],
    ["character outside Alloy", "fact { a ? b }"],
    ["unterminated block comment", "/* never closed\nsig A {}"]
];

describe("invalid Alloy syntax", () => {
    test.each(invalidSyntax)("%s is rejected", async (_name, text) => {
        const document = await parse(text);
        expect(syntaxErrors(document).length).toBeGreaterThan(0);
    });
});
