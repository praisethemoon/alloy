import {
    AstUtils, Cancellation, DefaultScopeComputation, DefaultScopeProvider, StreamScope, WorkspaceCache, stream,
    type AstNode, type AstNodeDescription, type LangiumDocument,
    type MultiMap, type ReferenceInfo, type Scope, type Stream
} from 'langium';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import type { AlloyModuleResolver } from './alloy-lsp-modules.js';
import {
    AssertDecl, AtNameExpr, CommandCall, DeclName, EnumDecl, FunDecl, ModuleParam, PredDecl, SigName, SigRef, TypeScope,
    isDecl, isDeclName, isLetBinding, isMacroParam, isSigDecl, type Decl, type Referable, type Specification
} from './generated/ast.js';

/**
 * The module-level declarations of a specification, each with what it is
 * called: sigs and their fields, enums and their members, preds, funs,
 * asserts and macros. Private ones only when asked for.
 */
export function* moduleDeclarations(spec: Specification, includePrivate: boolean): Generator<Referable> {
    for (const paragraph of spec.paragraphs) {
        switch (paragraph.$type) {
            case 'SigDecl':
                if (paragraph.private && !includePrivate) break;
                yield* paragraph.names;
                for (const field of paragraph.fields) {
                    if (!field.private || includePrivate) yield* field.names;
                }
                break;
            case 'EnumDecl':
                if (paragraph.private && !includePrivate) break;
                yield paragraph;
                yield* paragraph.members;
                break;
            case 'FunDecl':
            case 'PredDecl':
            case 'MacroDecl':
                if (!paragraph.private || includePrivate) yield paragraph;
                break;
            case 'AssertDecl':
                if (paragraph.name) yield paragraph;
                break;
        }
    }
}

/**
 * Exports every module-level declaration, not just the top-level nodes, and
 * puts variables in the scope of what binds them: parameters in their pred
 * or fun, quantified and comprehension variables in their expression.
 */
export class AlloyScopeComputation extends DefaultScopeComputation {

    override async collectExportedSymbols(document: LangiumDocument, cancelToken?: Cancellation.CancellationToken): Promise<AstNodeDescription[]> {
        const spec = document.parseResult.value as Specification;
        return this.collectExportedSymbolsForNode(spec, document, () => moduleDeclarations(spec, false), cancelToken);
    }

    protected override addLocalSymbol(node: AstNode, document: LangiumDocument, symbols: MultiMap<AstNode, AstNodeDescription>): void {
        if (isDeclName(node)) {
            const binder = node.$container.$container;
            if (!isSigDecl(binder)) {
                symbols.add(binder, this.descriptions.createDescription(node, node.name, document));
            }
        } else if (isLetBinding(node) || isMacroParam(node)) {
            super.addLocalSymbol(node, document, symbols);
        }
    }
}

/** Which declaration kinds a reference may denote, by where it appears. */
const allowedTargets: Record<string, ReadonlySet<string>> = {
    [`${SigRef.$type}:${SigRef.ref}`]: new Set([SigName.$type, ModuleParam.$type, EnumDecl.$type]),
    [`${TypeScope.$type}:${TypeScope.sig}`]: new Set([SigName.$type, ModuleParam.$type, EnumDecl.$type]),
    [`${CommandCall.$type}:${CommandCall.target}`]: new Set([PredDecl.$type, AssertDecl.$type, FunDecl.$type]),
    [`${AtNameExpr.$type}:${AtNameExpr.ref}`]: new Set([DeclName.$type])
};

/** Assertions are only named by commands. */
const notInExpressions: ReadonlySet<string> = new Set([AssertDecl.$type]);

/**
 * Alloy's namespaces: a module sees its own declarations as `x` and
 * `this/x`, and each opened module's public ones as `alias/x` and, when
 * nothing closer has that name, as `x`.
 */
export class AlloyScopeProvider extends DefaultScopeProvider {

    protected readonly modules: AlloyModuleResolver;
    protected readonly moduleScopes: WorkspaceCache<string, AstNodeDescription[]>;

    constructor(services: AlloyLspServices) {
        super(services);
        this.modules = services.references.ModuleResolver;
        this.moduleScopes = new WorkspaceCache(services.shared);
    }

    override getScope(context: ReferenceInfo): Scope {
        const scope = super.getScope(context);
        const allowed = allowedTargets[`${context.container.$type}:${context.property}`];
        const hidden = namesNotYetBound(context.container);
        const accepts = allowed
            ? (description: AstNodeDescription) => allowed.has(description.type)
            : (description: AstNodeDescription) => !notInExpressions.has(description.type);
        return new FilteredScope(scope, hidden.size === 0 ? accepts
            : description => accepts(description) && !(description.node && hidden.has(description.node)));
    }

    protected override getGlobalScope(_referenceType: string, context: ReferenceInfo): Scope {
        const document = AstUtils.getDocument(context.container) as LangiumDocument<Specification>;
        const elements = this.moduleScopes.get(document.uri.toString(), () => this.moduleScope(document));
        return new StreamScope(stream(elements));
    }

    protected moduleScope(document: LangiumDocument<Specification>): AstNodeDescription[] {
        const spec = document.parseResult.value;
        const own: AstNodeDescription[] = [];
        const describe = (node: Referable, doc: LangiumDocument, name: string) =>
            this.descriptions.createDescription(node, name, doc);
        const ownDeclarations: Referable[] = [...spec.module?.params ?? [], ...moduleDeclarations(spec, true)];
        for (const node of ownDeclarations) {
            if (!node.name) continue;
            own.push(describe(node, document, node.name), describe(node, document, `this/${node.name}`));
        }
        const qualified: AstNodeDescription[] = [];
        const unqualified: AstNodeDescription[] = [];
        for (const imported of this.modules.imports(document)) {
            if (!imported.document || imported.document === document) continue;
            for (const node of moduleDeclarations(imported.document.parseResult.value, false)) {
                if (!node.name) continue;
                qualified.push(describe(node, imported.document, `${imported.alias}/${node.name}`));
                unqualified.push(describe(node, imported.document, node.name));
            }
        }
        // The Analyzer also finds unqualified names in modules opened only
        // through others, unless an open on the way is private; their own
        // aliases stay invisible.
        const seen = new Set<LangiumDocument>([document, ...this.modules.imports(document).flatMap(i => i.document ? [i.document] : [])]);
        const queue = this.modules.imports(document).filter(i => i.document).map(i => i.document!);
        while (queue.length > 0) {
            const via = queue.shift()!;
            for (const imported of this.modules.imports(via)) {
                if (imported.private || !imported.document || seen.has(imported.document)) continue;
                seen.add(imported.document);
                queue.push(imported.document);
                for (const node of moduleDeclarations(imported.document.parseResult.value, false)) {
                    if (node.name) unqualified.push(describe(node, imported.document, node.name));
                }
            }
        }
        return [...own, ...qualified, ...unqualified];
    }
}

/**
 * The variables a reference inside a declaration's bound cannot see yet:
 * those of that declaration and of every later one in the same binder.
 * In `all x: A, y: x.f | …` the bound `x.f` sees `x` but not `y`.
 */
export function namesNotYetBound(node: AstNode): Set<AstNode> {
    const hidden = new Set<AstNode>();
    for (let child = node, parent = node.$container; parent; child = parent, parent = parent.$container) {
        if (isDecl(parent) && parent.type === child && !isSigDecl(parent.$container)) {
            const binder = parent.$container as AstNode & { decls?: Decl[], params?: Decl[] };
            const siblings = binder.decls ?? binder.params ?? [parent];
            for (const decl of siblings.slice(siblings.indexOf(parent))) {
                decl.names.forEach(name => hidden.add(name));
            }
        }
    }
    return hidden;
}

/** A scope that only lets some descriptions through. */
export class FilteredScope implements Scope {

    constructor(protected readonly inner: Scope, protected readonly accept: (description: AstNodeDescription) => boolean) {}

    getElement(name: string): AstNodeDescription | undefined {
        return this.getElements(name).head();
    }

    getElements(name: string): Stream<AstNodeDescription> {
        return this.inner.getElements(name).filter(this.accept);
    }

    getAllElements(): Stream<AstNodeDescription> {
        return this.inner.getAllElements().filter(this.accept);
    }
}
