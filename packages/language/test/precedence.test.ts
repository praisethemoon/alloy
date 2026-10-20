import { describe, expect, test } from "vitest";
import { expr } from "./helpers.js";

// Alloy.cup's levels, loosest first (lines 619-631 and the rule chain):
//   ;  ||  <=>  =>  &&  until/since/…  !/always/…  in/=/…  no/some/…  <<  +  fun/mul  #  ++  &  ->  <:  :>  . []  ~ * ^  '
// Each adjacent pair is checked in both orders.
const adjacentLevels: Array<[string, string, string]> = [
    ["a ; b || c", "(a ; (b || c))", "; is looser than ||"],
    ["a || b ; c", "((a || b) ; c)", "; is looser than ||"],
    ["a || b <=> c", "(a || (b <=> c))", "|| is looser than <=>"],
    ["a <=> b || c", "((a <=> b) || c)", "|| is looser than <=>"],
    ["a <=> b => c", "(a <=> (b => c))", "<=> is looser than =>"],
    ["a => b <=> c", "((a => b) <=> c)", "<=> is looser than =>"],
    ["a => b && c", "(a => (b && c))", "=> is looser than &&"],
    ["a && b => c", "((a && b) => c)", "=> is looser than &&"],
    ["a && b until c", "(a && (b until c))", "&& is looser than until"],
    ["a until b && c", "((a until b) && c)", "&& is looser than until"],
    ["!a until b", "((! a) until b)", "until is looser than !"],
    ["always a until b", "((always a) until b)", "until is looser than always"],
    ["!a in b", "(! (a in b))", "! is looser than in"],
    ["after a = b", "(after (a = b))", "after is looser than ="],
    ["no a = b", "((no a) = b)", "a comparison is looser than no"],
    ["no a << b", "(no (a << b))", "no is looser than <<"],
    ["a << b + c", "(a << (b + c))", "<< is looser than +"],
    ["a + b << c", "((a + b) << c)", "<< is looser than +"],
    ["a + b fun/mul c", "(a + (b fun/mul c))", "+ is looser than fun/mul"],
    ["a fun/mul b + c", "((a fun/mul b) + c)", "+ is looser than fun/mul"],
    ["#a fun/mul b", "((# a) fun/mul b)", "fun/mul is looser than #"],
    ["#a ++ b", "(# (a ++ b))", "# is looser than ++"],
    ["a ++ b & c", "(a ++ (b & c))", "++ is looser than &"],
    ["a & b ++ c", "((a & b) ++ c)", "++ is looser than &"],
    ["a & b -> c", "(a & (b -> c))", "& is looser than ->"],
    ["a -> b & c", "((a -> b) & c)", "& is looser than ->"],
    ["a -> b <: c", "(a -> (b <: c))", "-> is looser than <:"],
    ["a <: b -> c", "((a <: b) -> c)", "-> is looser than <:"],
    ["a <: b :> c", "(a <: (b :> c))", "<: is looser than :>"],
    ["a :> b <: c", "((a :> b) <: c)", "<: is looser than :>"],
    ["a :> b.c", "(a :> (b . c))", ":> is looser than ."],
    ["a.b :> c", "((a . b) :> c)", ":> is looser than ."],
    ["a.b[c]", "(a . b)[c]", ". and [] chain left to right"],
    ["a[b].c", "(a[b] . c)", ". and [] chain left to right"],
    ["~a.b", "((~ a) . b)", ". is looser than ~"],
    ["a.^b", "(a . (^ b))", ". is looser than ^"],
    ["~a'", "(~ a)'", "' is looser than ~"],
    ["x.f'", "(x . f')", "' is tighter than ."],
    ["(x.f)'", "(x . f)'", "a parenthesised prime applies to the join"]
];

const associativity: Array<[string, string, string]> = [
    ["a ; b ; c", "(a ; (b ; c))", "; is right-associative"],
    ["a || b || c", "((a || b) || c)", "|| is left-associative"],
    ["a <=> b <=> c", "((a <=> b) <=> c)", "<=> is left-associative"],
    ["a => b => c", "(a => (b => c))", "=> is right-associative"],
    ["a && b && c", "((a && b) && c)", "&& is left-associative"],
    ["a until b until c", "((a until b) until c)", "until chains to the left"],
    ["a = b = c", "((a = b) = c)", "comparisons chain to the left"],
    ["a + b - c", "((a + b) - c)", "+ and - are left-associative"],
    ["a -> b -> c", "(a -> (b -> c))", "-> is right-associative"],
    ["a.b.c", "((a . b) . c)", ". is left-associative"],
    ["a''", "a''", "primes stack"]
];

const specialForms: Array<[string, string, string]> = [
    ["a => b else c", "(a => b else c)", "else completes the =>"],
    ["a => b => c else d", "(a => (b => c else d))", "else belongs to the nearest =>"],
    ["a implies b else c", "(a implies b else c)", "implies takes else too"],
    ["a and all x: A | b or c", "(a and (all x: A | (b or c)))", "a quantifier body runs to the end"],
    ["all x: A | b or c", "(all x: A | (b or c))", "a quantifier body takes the whole formula"],
    ["a + let x = b | x", "(a + (let x = b | x))", "let can close an operator chain"],
    ["all x: some A | p", "(all x: (some A) | p)", "after ':' some is a multiplicity"],
    ["some x: A | p", "(some x: A | p)", "some with a declaration is a quantifier"],
    ["some x", "(some x)", "some without a declaration is a multiplicity"],
    ["a !in b", "(a !in b)", "! and in merge"],
    ["a not = b", "(a not= b)", "not and = merge"],
    ["a - 1", "(a - 1)", "minus after an operand is binary"],
    ["x = -1", "(x = -1)", "minus before a number at an operand start is a sign"],
    ["a some -> lone b", "(a some->lone b)", "arrows carry their multiplicities"],
    ["a -> set b", "(a ->set b)", "set is an arrow multiplicity"],
    ["a fun/add b", "(a fun/add b)", "fun/add is an infix operator"],
    ["sum x: A | #x", "(sum x: A | (# x))", "sum with a declaration is a quantifier"],
    ["sum a", "(sum a)", "sum without a declaration is a cast"],
    ["int[a]", "int[a]", "int with brackets is a call"],
    ["a.int", "(a . int)", "int after a dot is a call"],
    ["always a ; b", "((always a) ; b)", "; is looser than temporal operators"]
];

describe("precedence between adjacent levels", () => {
    test.each(adjacentLevels)("%s → %s (%s)", async (text, shape) => {
        expect(await expr(text)).toBe(shape);
    });
});

describe("associativity", () => {
    test.each(associativity)("%s → %s (%s)", async (text, shape) => {
        expect(await expr(text)).toBe(shape);
    });
});

describe("special forms", () => {
    test.each(specialForms)("%s → %s (%s)", async (text, shape) => {
        expect(await expr(text)).toBe(shape);
    });
});
