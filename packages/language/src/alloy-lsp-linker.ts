import { DefaultLinker, type AstNode, type AstNodeDescription, type LinkingError, type ReferenceInfo } from 'langium';
import { isAtNameExpr, isBoxJoinExpr, isDeclName, isFunDecl, isJoinExpr, isMacroDecl, isNameExpr, isPredDecl, isSigDecl, type JoinExpr, type SigDecl } from './generated/ast.js';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { extendsOrIs, overlaps, signatureFactOf, type AlloyTypeSystem } from './alloy-lsp-types.js';

/** Declarations that only live inside one pred, fun, quantifier or let, and shadow everything else. */
const localTypes = new Set(['DeclName', 'LetBinding', 'MacroParam']);

/**
 * Alloy lets preds and funs share a name when their parameters differ. A
 * call picks the one whose parameter count matches its arguments, counting
 * the receiver of `x.f[y]` as the first argument.
 */
export class AlloyLinker extends DefaultLinker {

    protected readonly types: AlloyTypeSystem;
    protected readonly joinsDeciding = new Set<JoinExpr>();

    constructor(services: AlloyLspServices) {
        super(services);
        this.types = services.typing.TypeSystem;
    }

    override getCandidate(refInfo: ReferenceInfo): AstNodeDescription | LinkingError {
        const candidates = this.scopeProvider.getScope(refInfo).getElements(refInfo.reference.$refText).toArray();
        if (candidates.length === 0) {
            return this.createLinkingError(refInfo);
        }
        const first = candidates[0];
        if (candidates.length === 1 || this.isLocal(first)) {
            return first;
        }
        const arity = callArity(refInfo.container);
        if (arity !== undefined) {
            const match = candidates.find(candidate => parameterCount(this.loadAstNode(candidate)) === arity);
            if (match) {
                return match;
            }
            return this.fieldByContext(refInfo.container, candidates) ?? first;
        }
        // Not called, so a pred or fun with parameters can't be meant.
        const uncalled = candidates.filter(candidate => !parameterCount(this.loadAstNode(candidate)));
        const pool = uncalled.length > 0 ? uncalled : candidates;
        return this.fieldByContext(refInfo.container, pool) ?? pool[0];
    }

    /**
     * Among same-named fields of different sigs, the one the context types:
     * after a dot, the field whose sig meets the left side's last column;
     * before a dot, the field whose last column meets the right side's first;
     * bare in a signature fact, first of all, the field of that sig or one it
     * extends, and failing everything else, of a sig extending it.
     */
    protected fieldByContext(node: AstNode, candidates: AstNodeDescription[]): AstNodeDescription | undefined {
        const fields = candidates
            .map(description => ({ description, owner: fieldOwner(this.loadAstNode(description)) }))
            .filter((f): f is { description: AstNodeDescription, owner: SigDecl } => f.owner !== undefined);
        if (fields.length < 2) return undefined;
        // In a signature fact a bare name is this.f, so the fact's sig or an ancestor owns it.
        const sig = signatureFactOf(node);
        const own = sig && isNameExpr(node) ? fields.find(f => extendsOrIs(sig, f.owner)) : undefined;
        if (own) return own.description;
        if (!isNameExpr(node) && !isAtNameExpr(node)) return undefined;
        const parent = node.$container;
        // In f.g with both overloaded, each side's choice types the other: the side asked second gets no say.
        if (isJoinExpr(parent) && !this.joinsDeciding.has(parent)) {
            this.joinsDeciding.add(parent);
            try {
                const byJoin = this.fieldByJoin(parent, node, fields);
                if (byJoin) return byJoin;
            } finally {
                this.joinsDeciding.delete(parent);
            }
        }
        // Otherwise, as with @f in a signature fact, a field of a sig extending the fact's.
        return sig ? fields.find(f => extendsOrIs(f.owner, sig))?.description : undefined;
    }

    protected fieldByJoin(parent: JoinExpr, node: AstNode, fields: Array<{ description: AstNodeDescription, owner: SigDecl }>): AstNodeDescription | undefined {
        if (parent.right === node) {
            const left = this.types.typeOf(parent.left);
            if (left.kind !== 'relation') return undefined;
            const lastColumns = left.relations.map(r => r[r.length - 1]);
            return fields.find(f => f.owner.names.some(sig => lastColumns.some(column => overlaps(column, sig))))?.description;
        }
        if (parent.left === node) {
            const right = this.types.typeOf(parent.right);
            if (right.kind !== 'relation') return undefined;
            const firstColumns = right.relations.map(r => r[0]);
            return fields.find(f => {
                const type = this.types.typeOf(this.loadAstNode(f.description)!);
                return type.kind === 'relation' && type.relations.some(r => firstColumns.some(column => overlaps(r[r.length - 1], column)));
            })?.description;
        }
        return undefined;
    }

    /** A parameter, bound variable, let binding or macro parameter: not a field, which is a DeclName of a sig. */
    protected isLocal(description: AstNodeDescription): boolean {
        if (!localTypes.has(description.type)) {
            return false;
        }
        const node = this.loadAstNode(description);
        return !(isDeclName(node) && isSigDecl(node.$container.$container));
    }
}

/** How many arguments a name receives when it is called with brackets, or undefined when it is not called. */
export function callArity(node: AstNode): number | undefined {
    if (!isNameExpr(node)) {
        return undefined;
    }
    const parent = node.$container;
    if (isBoxJoinExpr(parent) && parent.target === node) {
        return parent.args.length;
    }
    if (isJoinExpr(parent) && parent.right === node && isBoxJoinExpr(parent.$container) && parent.$container.target === parent) {
        return parent.$container.args.length + 1;
    }
    return undefined;
}

/** The sig declaration a field belongs to; undefined for anything that is not a field. */
function fieldOwner(node: AstNode | undefined): SigDecl | undefined {
    if (!isDeclName(node)) return undefined;
    const owner = node.$container.$container;
    return isSigDecl(owner) ? owner : undefined;
}

/** The number of arguments a pred, fun or macro takes, receiver included; undefined for anything else. */
export function parameterCount(node: AstNode | undefined): number | undefined {
    if (isFunDecl(node) || isPredDecl(node)) {
        return node.params.reduce((count, decl) => count + decl.names.length, node.receiver ? 1 : 0);
    }
    if (isMacroDecl(node)) {
        return node.params.length;
    }
    return undefined;
}
