import { DefaultLinker, type AstNode, type AstNodeDescription, type LinkingError, type ReferenceInfo } from 'langium';
import { isBoxJoinExpr, isDeclName, isFunDecl, isJoinExpr, isMacroDecl, isNameExpr, isPredDecl, isSigDecl, type SigDecl } from './generated/ast.js';
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
        }
        return this.fieldByContext(refInfo.container, candidates) ?? first;
    }

    /**
     * Among same-named fields of different sigs, the one the context types:
     * after a dot, the field whose sig meets the left side's last column;
     * bare in a signature fact, the field of that sig or one it extends.
     */
    protected fieldByContext(node: AstNode, candidates: AstNodeDescription[]): AstNodeDescription | undefined {
        const fields = candidates
            .map(description => ({ description, owner: fieldOwner(this.loadAstNode(description)) }))
            .filter((f): f is { description: AstNodeDescription, owner: SigDecl } => f.owner !== undefined);
        if (fields.length < 2 || !isNameExpr(node)) return undefined;
        const parent = node.$container;
        if (isJoinExpr(parent) && parent.right === node) {
            const left = this.types.typeOf(parent.left);
            if (left.kind !== 'relation') return undefined;
            const lastColumns = left.relations.map(r => r[r.length - 1]);
            return fields.find(f => f.owner.names.some(sig => lastColumns.some(column => overlaps(column, sig))))?.description;
        }
        const sig = signatureFactOf(node);
        return sig ? fields.find(f => extendsOrIs(sig, f.owner))?.description : undefined;
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
