import { describe, expect, test } from "vitest";
import { AstUtils, DocumentValidator, UriUtils, type AstNode, type LangiumDocument, type Reference } from "langium";
import { isDeclName, isFunDecl, isPredDecl, utilLibrary, utilLibraryUri, type Specification } from "alloy-lsp-language";
import { alloyServices, parse } from "./helpers.js";

/** Linking errors and Alloy validation errors, without syntax errors. */
function linkErrors(document: LangiumDocument): string[] {
    return (document.diagnostics ?? [])
        .filter(d => d.severity === 1 && d.data?.code !== DocumentValidator.LexingError && d.data?.code !== DocumentValidator.ParsingError)
        .map(d => typeof d.message === "string" ? d.message : d.message.value);
}

/** What a declaration is, where it lives: `field A.f`, `param p.x`, `var x`, `FunDecl first @ util/ordering.als`. */
function describeTarget(node: AstNode): string {
    const file = UriUtils.basename(AstUtils.getDocument(node).uri);
    if (isDeclName(node)) {
        const binder = node.$container.$container;
        if (binder.$type === "SigDecl") return `field ${binder.names.map(n => n.name).join(",")}.${node.name} @ ${file}`;
        if (isPredDecl(binder) || isFunDecl(binder)) return `param ${binder.name}.${node.name} @ ${file}`;
        return `var ${node.name} @ ${file}`;
    }
    return `${node.$type} ${(node as { name?: string }).name} @ ${file}`;
}

/** Every reference in the document as `text -> target`, in document order. */
function links(document: LangiumDocument<Specification>): string[] {
    return AstUtils.streamAst(document.parseResult.value)
        .flatMap(node => AstUtils.streamReferences(node))
        .map(({ reference }) => reference as Reference)
        .map(reference => `${reference.$refText} -> ${reference.ref ? describeTarget(reference.ref) : "unresolved"}`)
        .toArray();
}

describe("the bundled util library", () => {
    test.each(Object.keys(utilLibrary).sort())("%s links with no unresolved references", async module => {
        const services = await alloyServices();
        const document = services.shared.workspace.LangiumDocuments.getDocument(utilLibraryUri(module))!;
        const diagnostics = await services.AlloyLsp.validation.DocumentValidator.validateDocument(document);
        expect(diagnostics.filter(d => d.severity === 1).map(d => d.message)).toEqual([]);
    });
});

describe("names inside one module", () => {
    test("sigs, parents and fields, including fields inherited through extends", async () => {
        const document = await parse(`
            abstract sig A { f: A }
            sig B extends A {}
            fact { all b: B | some b.f }
        `, "file:///linking/fields.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "A -> SigName A @ fields.als",
            "A -> SigName A @ fields.als",
            "B -> SigName B @ fields.als",
            "b -> var b @ fields.als",
            "f -> field A.f @ fields.als"
        ]);
    });

    test("parameters shadow module-level names, and quantified variables shadow parameters", async () => {
        const document = await parse(`
            sig X {}
            pred p[X: univ] { some X and all X: X | no X }
        `, "file:///linking/shadow.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "X -> param p.X @ shadow.als",
            "X -> param p.X @ shadow.als",
            "X -> var X @ shadow.als"
        ]);
    });

    test("a bound sees the variables declared before it, not its own or later ones", async () => {
        const document = await parse(`
            sig A { f: A }
            fact { all x: A, y: x.f | some y }
            pred q[a: A, b: a.f] {}
        `, "file:///linking/order.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "A -> SigName A @ order.als",
            "A -> SigName A @ order.als",
            "x -> var x @ order.als",
            "f -> field A.f @ order.als",
            "y -> var y @ order.als",
            "A -> SigName A @ order.als",
            "a -> param q.a @ order.als",
            "f -> field A.f @ order.als"
        ]);
    });

    test("let bindings, comprehension variables and macro parameters", async () => {
        const document = await parse(`
            sig A {}
            fact { let a = A | some a }
            fact { some {x: A | some x} }
            let twice[e] = e + e
        `, "file:///linking/locals.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "A -> SigName A @ locals.als",
            "a -> LetBinding a @ locals.als",
            "A -> SigName A @ locals.als",
            "x -> var x @ locals.als",
            "e -> MacroParam e @ locals.als",
            "e -> MacroParam e @ locals.als"
        ]);
    });

    test("this/ names and @ fields", async () => {
        const document = await parse(`
            sig A { f: this/A } { @f = f }
        `, "file:///linking/this.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "this/A -> SigName A @ this.als",
            "f -> field A.f @ this.als",
            "f -> field A.f @ this.als"
        ]);
    });

    test("commands name preds and asserts, and scopes name sigs", async () => {
        const document = await parse(`
            sig A {}
            pred show {}
            assert ok { some A }
            run show for 3 but 2 A
            check ok
        `, "file:///linking/commands.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "A -> SigName A @ commands.als",
            "show -> PredDecl show @ commands.als",
            "A -> SigName A @ commands.als",
            "ok -> AssertDecl ok @ commands.als"
        ]);
    });

    test("enums and their members", async () => {
        const document = await parse(`
            enum Color { Red, Green }
            fact { Red in Color }
        `, "file:///linking/enums.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "Red -> EnumMember Red @ enums.als",
            "Color -> EnumDecl Color @ enums.als"
        ]);
    });

    test("a module parameter is a sig inside its module", async () => {
        const document = await parse(`
            module m[elem]
            sig Box { item: elem }
        `, "file:///linking/m.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual(["elem -> ModuleParam elem @ m.als"]);
    });

    test("overloaded preds are chosen by arity, counting the receiver", async () => {
        const document = await parse(`
            sig A {} sig B {}
            pred p[a: A] {}
            pred p[a: A, b: B] {}
            fact { p[A] and p[A, B] and A.p[B] }
        `, "file:///linking/overloads.als");
        expect(linkErrors(document)).toEqual([]);
        const calls = document.parseResult.value.paragraphs.flatMap(p => AstUtils.streamAst(p)
            .flatMap(node => AstUtils.streamReferences(node))
            .map(({ reference }) => reference as Reference)
            .filter(reference => reference.$refText === "p")
            .map(reference => (isPredDecl(reference.ref) ? reference.ref.params.length : -1))
            .toArray());
        expect(calls).toEqual([1, 2, 2]);
    });

    test("each position only accepts the declarations that belong there", async () => {
        const document = await parse(`
            pred p {}
            assert a {}
            sig X extends p {}
            fact { some a }
        `, "file:///linking/kinds.als");
        expect(links(document)).toEqual(["p -> unresolved", "a -> unresolved"]);
    });
});

describe("names across modules", () => {
    test("open util/ordering gives plain and alias-qualified names, and keeps its private sig hidden", async () => {
        const document = await parse(`
            open util/ordering[State] as so
            sig State {}
            fact { some first and so/next[so/first] in State }
            fact { some Ord }
        `, "file:///linking/ordering.als");
        expect(links(document)).toEqual([
            "State -> SigName State @ ordering.als",
            "first -> FunDecl first @ ordering.als",
            "so/next -> FunDecl next @ ordering.als",
            "so/first -> FunDecl first @ ordering.als",
            "State -> SigName State @ ordering.als",
            "Ord -> unresolved"
        ]);
    });

    test("without as, the alias is the last path segment", async () => {
        const document = await parse(`
            open util/relation
            sig A { r: A }
            fact { relation/acyclic[r, A] }
        `, "file:///linking/relation.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toContain("relation/acyclic -> PredDecl acyclic @ relation.als");
    });

    test("every module implicitly opens util/integer as integer", async () => {
        const document = await parse("fact { integer/plus[1, 2] = 3 and plus[1, 2] = 3 }", "file:///linking/integer.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual([
            "integer/plus -> FunDecl plus @ integer.als",
            "plus -> FunDecl plus @ integer.als"
        ]);
    });

    test("workspace modules resolve beside the importer and under its module root", async () => {
        await parse("module lib/c\nsig C {}\nprivate sig Hidden {}", "file:///ws/lib/c.als");
        await parse("sig B {}", "file:///ws/b.als");
        const document = await parse(`
            module main
            open b
            open lib/c
            fact { some B and some c/C and some Hidden }
        `, "file:///ws/main.als");
        expect(links(document)).toEqual([
            "B -> SigName B @ b.als",
            "c/C -> SigName C @ c.als",
            "Hidden -> unresolved"
        ]);
    });

    test("a module header's folders are stripped to find the root", async () => {
        await parse("module x/y/z\nsig Z {}", "file:///deep/x/y/z.als");
        await parse("sig W {}", "file:///deep/w.als");
        const document = await parse("module x/y/main\nopen w\nopen x/y/z\nfact { some W and some Z }", "file:///deep/x/y/main.als");
        expect(linkErrors(document)).toEqual([]);
        expect(links(document)).toEqual(["W -> SigName W @ w.als", "Z -> SigName Z @ z.als"]);
    });

    test("an open that names no module is an error", async () => {
        const document = await parse("open nowhere/to/be/found", "file:///linking/missing.als");
        expect(linkErrors(document)).toEqual([
            "Cannot find module 'nowhere/to/be/found': no nowhere/to/be/found.als next to this module's root, no workspace module declares it, and it is not in the util library."
        ]);
    });
});
