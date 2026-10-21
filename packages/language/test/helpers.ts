import { DocumentValidator, EmptyFileSystem, type LangiumDocument } from "langium";
import { parseHelper } from "langium/test";
import type { Decl, Expr, Specification } from "alloy-lsp-language";
import { createAlloyLspServices, isFactDecl } from "alloy-lsp-language";

const services = createAlloyLspServices(EmptyFileSystem);
const parseDocument = parseHelper<Specification>(services.AlloyLsp);

let workspace: Promise<void> | undefined;

/** The shared services, with the bundled util library loaded into their workspace. */
export async function alloyServices(): Promise<typeof services> {
    workspace ??= services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    await workspace;
    return services;
}

export async function parse(text: string, documentUri?: string): Promise<LangiumDocument<Specification>> {
    await alloyServices();
    return parseDocument(text, { validation: true, documentUri });
}

const syntaxCodes: unknown[] = [DocumentValidator.LexingError, DocumentValidator.ParsingError];

/**
 * Langium's own lexing and parsing diagnostics, as the editor shows them, one per line;
 * empty when the text is valid Alloy syntax. Linking and custom diagnostics are left out.
 */
export function syntaxErrors(document: LangiumDocument): string[] {
    return (document.diagnostics ?? [])
        .filter(d => syntaxCodes.includes(d.data?.code))
        .map(d => `${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.message}`);
}

/** Parses `fact { text }` and shows the AST of its first formula. */
export async function expr(text: string): Promise<string> {
    const document = await parse(`fact { ${text} }`);
    const errors = syntaxErrors(document);
    if (errors.length > 0) {
        return errors.join("\n");
    }
    const fact = document.parseResult.value.paragraphs[0];
    if (!isFactDecl(fact) || fact.body.exprs.length !== 1) {
        return `expected one formula in the fact, got ${isFactDecl(fact) ? fact.body.exprs.length : fact?.$type}`;
    }
    return show(fact.body.exprs[0]);
}

/** A fully parenthesised rendering of an expression, so tests can state its shape. */
export function show(e: Expr): string {
    switch (e.$type) {
        case "SequenceExpr": return `(${show(e.left)} ; ${show(e.right)})`;
        case "BinaryExpr": return `(${show(e.left)} ${e.op} ${show(e.right)})`;
        case "ImpliesExpr":
            return `(${show(e.condition)} ${e.op} ${show(e.then)}${e.else ? ` else ${show(e.else)}` : ""})`;
        case "ArrowExpr": return `(${show(e.left)} ${e.leftMult ?? ""}->${e.rightMult ?? ""} ${show(e.right)})`;
        case "UnaryExpr": return `(${e.op} ${show(e.operand)})`;
        case "PrimeExpr": return `${show(e.operand)}'`;
        case "JoinExpr": return `(${show(e.left)} . ${show(e.right)})`;
        case "BoxJoinExpr": return `${show(e.target)}[${e.args.map(show).join(", ")}]`;
        case "BuiltinCall": return `${e.fn}[${e.args.map(show).join(", ")}]`;
        case "BuiltinRef": return e.fn;
        case "BuiltinSigExpr": return e.name;
        case "NameExpr": return e.ref.$refText;
        case "AtNameExpr": return `@${e.ref.$refText}`;
        case "ConstantExpr": return e.value;
        case "NumberLiteral": return `${e.negative ? "-" : ""}${e.value}`;
        case "StringLiteral": return e.value;
        case "Block": return `{${e.exprs.map(show).join(" ")}}`;
        case "Comprehension":
            return `{${e.decls.map(showDecl).join(", ")}${e.body ? ` | ${show(e.body)}` : ""}}`;
        case "LetExpr":
            return `(let ${e.bindings.map(b => `${b.name} = ${show(b.value)}`).join(", ")} | ${show(e.body)})`;
        case "QuantifiedExpr":
            return `(${e.quantifier} ${e.decls.map(showDecl).join(", ")} | ${show(e.body)})`;
    }
}

export function showDecl(d: Decl): string {
    const prefix = [d.var && "var", d.private && "private", d.disj && "disj"].filter(Boolean).join(" ");
    const names = d.names.map(n => n.name).join(", ");
    return `${prefix ? prefix + " " : ""}${names}${d.defines ? " =" : ":"} ${d.disjType ? "disj " : ""}${show(d.type)}`;
}
