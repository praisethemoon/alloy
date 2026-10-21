import { AstUtils, GrammarUtils, type AstNode, type LangiumDocument, type ValidationAcceptor, type ValidationChecks } from 'langium';
import {
    isDeclName, isFunDecl, isPredDecl, isSigName,
    type AlloyLspAstType, type Comprehension, type Decl, type DeclName, type FunDecl, type Open, type PredDecl,
    type QuantifiedExpr, type SigDecl, type SigName, type Specification, type StringLiteral
} from './generated/ast.js';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import type { AlloyModuleResolver } from './alloy-lsp-modules.js';
import { moduleDeclarations } from './alloy-lsp-scope.js';
import type { AlloyTypeSystem } from './alloy-lsp-types.js';

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: AlloyLspServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.AlloyLspValidator;
    const checks: ValidationChecks<AlloyLspAstType> = {
        Open: validator.checkOpenResolves,
        Specification: [validator.checkTypes, validator.checkDuplicateNames],
        SigDecl: [validator.checkSigQualifiers, validator.checkExtends, validator.checkFieldClashes],
        Decl: validator.checkVar,
        QuantifiedExpr: validator.checkBinderNames,
        Comprehension: validator.checkBinderNames,
        FunDecl: validator.checkBinderNames,
        PredDecl: validator.checkBinderNames,
        StringLiteral: validator.checkStringNotEmpty,
        SigName: validator.checkNameHasNoDollar,
        DeclName: validator.checkNameHasNoDollar,
        EnumDecl: validator.checkNameHasNoDollar,
        EnumMember: validator.checkNameHasNoDollar,
        AssertDecl: validator.checkNameHasNoDollar,
        MacroDecl: validator.checkNameHasNoDollar,
        MacroParam: validator.checkNameHasNoDollar,
        LetBinding: validator.checkNameHasNoDollar
    };
    registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class AlloyLspValidator {

    protected readonly modules: AlloyModuleResolver;
    protected readonly types: AlloyTypeSystem;

    constructor(services: AlloyLspServices) {
        this.modules = services.references.ModuleResolver;
        this.types = services.typing.TypeSystem;
    }

    checkOpenResolves(open: Open, accept: ValidationAcceptor): void {
        const document = AstUtils.getDocument(open) as LangiumDocument<Specification>;
        if (!this.modules.resolve(document, open.path)) {
            accept('error', `Cannot find module '${open.path}': no ${open.path}.als next to this module's root, no workspace module declares it, and it is not in the util library.`,
                { node: open, property: 'path' });
        }
    }

    /** Arity errors, formula/expression mix-ups and always-empty expressions, from type inference. */
    checkTypes(spec: Specification, accept: ValidationAcceptor): void {
        const document = AstUtils.getDocument(spec) as LangiumDocument<Specification>;
        for (const issue of this.types.issues(document)) {
            accept(issue.severity, issue.message, { node: issue.node });
        }
    }

    /** One module-level name per declaration, except that preds and funs may overload each other. */
    checkDuplicateNames(spec: Specification, accept: ValidationAcceptor): void {
        const byName = new Map<string, AstNode[]>();
        for (const node of moduleDeclarations(spec, true)) {
            if (isDeclName(node) || !node.name) continue;
            byName.set(node.name, [...byName.get(node.name) ?? [], node]);
        }
        for (const [name, nodes] of byName) {
            if (nodes.length < 2 || nodes.every(n => isPredDecl(n) || isFunDecl(n))) continue;
            for (const node of nodes.slice(1)) {
                accept('error', `'${name}' is already declared in this module (line ${line(nodes[0])}).`, { node, property: 'name' });
            }
        }
    }

    /** At most one of each qualifier, and at most one multiplicity, before `sig`. */
    checkSigQualifiers(sig: SigDecl, accept: ValidationAcceptor): void {
        const cst = sig.$cstNode;
        if (!cst) return;
        for (const qualifier of ['abstract', 'private', 'var']) {
            const repeats = GrammarUtils.findNodesForKeyword(cst, qualifier);
            if (repeats.length > 1) {
                accept('error', `'${qualifier}' is given ${repeats.length} times.`, { node: sig, keyword: qualifier, index: 1 });
            }
        }
        const multiplicities = ['lone', 'one', 'some'].flatMap(m => GrammarUtils.findNodesForKeyword(cst, m));
        if (multiplicities.length > 1) {
            accept('error', `A sig takes at most one multiplicity, but ${multiplicities.map(m => m.text).join(' and ')} are given.`, { node: sig, property: 'multiplicity' });
        }
    }

    /** extends names a sig declared without `in`, and never leads back to the sig itself. */
    checkExtends(sig: SigDecl, accept: ValidationAcceptor): void {
        const parent = sig.extends?.ref?.ref;
        if (!isSigName(parent)) return;
        if (parent.$container.in.length > 0 || parent.$container.equals.length > 0) {
            accept('error', `'${parent.name}' is a subset sig (declared with in or =), and only sigs declared with extends or at the top can be extended.`,
                { node: sig, property: 'extends' });
            return;
        }
        const seen = new Set<SigDecl>();
        for (let current: SigName | undefined = parent; current; current = parentSig(current)) {
            if (current.$container === sig) {
                accept('error', `'${sig.names.map(n => n.name).join(', ')}' extends itself through '${parent.name}'.`, { node: sig, property: 'extends' });
                return;
            }
            if (seen.has(current.$container)) return;
            seen.add(current.$container);
        }
    }

    /** A field name appears once in a sig and its ancestors. */
    checkFieldClashes(sig: SigDecl, accept: ValidationAcceptor): void {
        const own = new Map<string, DeclName>();
        for (const name of sig.fields.flatMap(f => f.names)) {
            const earlier = own.get(name.name);
            if (earlier) {
                accept('error', `Field '${name.name}' is already declared in this sig (line ${line(earlier)}).`, { node: name, property: 'name' });
            } else {
                own.set(name.name, name);
            }
        }
        const seen = new Set<SigDecl>([sig]);
        for (let ancestor = sig.names[0] && parentSig(sig.names[0]); ancestor && !seen.has(ancestor.$container); ancestor = parentSig(ancestor)) {
            seen.add(ancestor.$container);
            for (const inherited of ancestor.$container.fields.flatMap(f => f.names)) {
                const clash = own.get(inherited.name);
                if (clash) {
                    accept('error', `Field '${clash.name}' clashes with the field of that name in '${ancestor.name}', which this sig extends.`, { node: clash, property: 'name' });
                }
            }
        }
    }

    /** `var` marks sig fields only; parameters and bound variables are never mutable. */
    checkVar(decl: Decl, accept: ValidationAcceptor): void {
        if (decl.var && decl.$container.$type !== 'SigDecl') {
            accept('error', "'var' can only mark sig fields; parameters and bound variables are not mutable.", { node: decl, property: 'var' });
        }
    }

    /** The variables one quantifier, comprehension, pred or fun declares have distinct names. */
    checkBinderNames(binder: QuantifiedExpr | Comprehension | FunDecl | PredDecl, accept: ValidationAcceptor): void {
        const decls: Decl[] = 'decls' in binder ? binder.decls : binder.params;
        const seen = new Map<string, DeclName>();
        for (const name of decls.flatMap(d => d.names)) {
            if (seen.has(name.name)) {
                accept('error', `'${name.name}' is declared twice here.`, { node: name, property: 'name' });
            } else {
                seen.set(name.name, name);
            }
        }
    }

    /** The Analyzer rejects "", suggesting an empty set instead. */
    checkStringNotEmpty(literal: StringLiteral, accept: ValidationAcceptor): void {
        if (literal.value === '') {
            accept('error', 'An empty string is not allowed; use an empty set (none) instead.', { node: literal });
        }
    }

    /** The Analyzer reserves `$` for the names it generates. */
    checkNameHasNoDollar(node: AstNode & { name?: string }, accept: ValidationAcceptor): void {
        if (node.name?.includes('$')) {
            accept('error', `'${node.name}': names cannot contain '$', which the Analyzer reserves for its own.`, { node, property: 'name' });
        }
    }

}

function parentSig(sig: SigName): SigName | undefined {
    const target = sig.$container.extends?.ref?.ref;
    return isSigName(target) ? target : undefined;
}

function line(node: AstNode): number {
    return (node.$cstNode?.range.start.line ?? 0) + 1;
}
