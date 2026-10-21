import { DefaultLinker, type AstNode, type AstNodeDescription, type LinkingError, type ReferenceInfo } from 'langium';
import { isBoxJoinExpr, isDeclName, isFunDecl, isJoinExpr, isMacroDecl, isNameExpr, isPredDecl, isSigDecl } from './generated/ast.js';

/** Declarations that only live inside one pred, fun, quantifier or let, and shadow everything else. */
const localTypes = new Set(['DeclName', 'LetBinding', 'MacroParam']);

/**
 * Alloy lets preds and funs share a name when their parameters differ. A
 * call picks the one whose parameter count matches its arguments, counting
 * the receiver of `x.f[y]` as the first argument.
 */
export class AlloyLinker extends DefaultLinker {

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
        return first;
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
