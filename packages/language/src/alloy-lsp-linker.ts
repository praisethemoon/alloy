import { DefaultLinker, type AstNode, type AstNodeDescription, type LinkingError, type ReferenceInfo } from 'langium';
import {
    isArrowExpr, isAssertDecl, isAtNameExpr, isBinaryExpr, isBlock, isBoxJoinExpr, isDeclName, isFactDecl, isFunDecl, isImpliesExpr, isJoinExpr,
    isMacroDecl, isNameExpr, isPredDecl, isQuantifiedExpr, isSequenceExpr, isSigDecl, isUnaryExpr, type BinaryExpr, type SigDecl
} from './generated/ast.js';
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
    /** Joins and restrictions whose operands are being resolved by each other's type. */
    protected readonly joinsDeciding = new Set<AstNode>();

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
        // Where only a relation fits, as in s.(New <: init), a pred can't be meant either;
        // where only a formula fits, as in `init and step`, nothing but a pred can.
        const fitting = expectsRelation(refInfo.container) ? uncalled.filter(candidate => candidate.type !== 'PredDecl')
            : expectsFormula(refInfo.container) ? uncalled.filter(candidate => candidate.type === 'PredDecl') : uncalled;
        const pool = fitting.length > 0 ? fitting : uncalled.length > 0 ? uncalled : candidates;
        if (pool.length === 1) return pool[0];
        return this.fieldByContext(refInfo.container, pool) ?? this.byJoinType(refInfo.container, pool) ?? pool[0];
    }

    /**
     * After a dot, the candidate of any kind whose first column meets the
     * left side's last, as with table.next where both a field next of
     * another sig and util/ordering's fun next are in scope.
     */
    protected byJoinType(node: AstNode, candidates: AstNodeDescription[]): AstNodeDescription | undefined {
        const parent = node.$container;
        if (candidates.length < 2 || !isNameExpr(node) || !isJoinExpr(parent) || parent.right !== node || this.joinsDeciding.has(parent)) return undefined;
        this.joinsDeciding.add(parent);
        try {
            const left = this.types.typeOf(parent.left);
            if (left.kind !== 'relation') return undefined;
            const lastColumns = left.relations.map(r => r[r.length - 1]);
            return candidates.find(candidate => {
                const type = this.types.declarationType(this.loadAstNode(candidate)!);
                return type.kind === 'relation' && type.relations.some(r => lastColumns.some(column => overlaps(column, r[0])));
            });
        } finally {
            this.joinsDeciding.delete(parent);
        }
    }

    /**
     * Among same-named fields of different sigs, the one the context types:
     * after a dot, the field whose sig meets the left side's last column;
     * before a dot, the field whose last column meets the right side's first;
     * bare in a signature fact, the field of that sig or one it extends, which
     * comes first except after a dot; and failing everything else, a field of
     * a sig extending the fact's.
     */
    protected fieldByContext(node: AstNode, candidates: AstNodeDescription[]): AstNodeDescription | undefined {
        const fields = candidates
            .map(description => ({ description, owner: fieldOwner(this.loadAstNode(description)) }))
            .filter((f): f is { description: AstNodeDescription, owner: SigDecl } => f.owner !== undefined);
        if (fields.length < 2) return undefined;
        if (!isNameExpr(node) && !isAtNameExpr(node)) return undefined;
        const parent = node.$container;
        // In a signature fact a bare name is this.f, so the fact's sig or an ancestor owns it,
        // unless it follows a dot whose left side another sig's field fits.
        const sig = signatureFactOf(node);
        const own = sig && isNameExpr(node) ? fields.find(f => extendsOrIs(sig, f.owner)) : undefined;
        const afterDot = isJoinExpr(parent) && parent.right === node;
        if (own && !afterDot) return own.description;
        if (isRestriction(parent) && !this.joinsDeciding.has(parent)) {
            this.joinsDeciding.add(parent);
            try {
                const byRestriction = this.fieldByRestriction(parent, node, fields);
                if (byRestriction) return byRestriction;
            } finally {
                this.joinsDeciding.delete(parent);
            }
        }
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
        if (own) return own.description;
        // Otherwise, as with @f in a signature fact, a field of a sig extending the fact's.
        return sig ? fields.find(f => extendsOrIs(f.owner, sig))?.description : undefined;
    }

    /**
     * In S <: f, the field whose domain meets S; in f :> S, the field whose
     * range meets S, as with s.(Lit <: dst) where many sigs have a dst.
     */
    protected fieldByRestriction(parent: BinaryExpr, node: AstNode, fields: Array<{ description: AstNodeDescription, owner: SigDecl }>): AstNodeDescription | undefined {
        const domain = parent.op === '<:' && parent.right === node;
        if (!domain && !(parent.op === ':>' && parent.left === node)) return undefined;
        const set = this.types.typeOf(domain ? parent.left : parent.right);
        if (set.kind !== 'relation') return undefined;
        const columns = set.relations.filter(r => r.length === 1).map(r => r[0]);
        return fields.find(f => {
            const type = this.types.typeOf(this.loadAstNode(f.description)!);
            return type.kind === 'relation' && type.relations.some(r => columns.some(column => overlaps(column, domain ? r[0] : r[r.length - 1])));
        })?.description;
    }

    protected fieldByJoin(parent: AstNode & { left: AstNode, right: AstNode }, node: AstNode, fields: Array<{ description: AstNodeDescription, owner: SigDecl }>): AstNodeDescription | undefined {
        if (parent.right === node) {
            const left = this.types.typeOf(parent.left);
            if (left.kind !== 'relation') return undefined;
            const lastColumns = left.relations.map(r => r[r.length - 1]);
            // The field's own first column, which for a subset sig's field is the sig's parents.
            return fields.find(f => {
                const type = this.types.typeOf(this.loadAstNode(f.description)!);
                return type.kind === 'relation' && type.relations.some(r => lastColumns.some(column => overlaps(column, r[0])));
            })?.description;
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

/** Operators whose operands are sets or relations, never formulas. */
const relationalOps = new Set(['+', '-', '++', '&', '<:', ':>', '<<', '>>', '>>>']);
const relationalUnary = new Set(['~', '^', '*', '#', 'set', 'seq', 'sum', 'int', 'no', 'some', 'lone', 'one']);

/** Whether a name stands where only a set or relation can: an operand of a join, product, restriction, union and the like. */
function expectsRelation(node: AstNode): boolean {
    const parent = node.$container;
    return isJoinExpr(parent) || isArrowExpr(parent) || (isBoxJoinExpr(parent) && parent.target === node)
        || (isBinaryExpr(parent) && (relationalOps.has(parent.op) || /^(!|not)?(in|=)$/.test(parent.op)))
        || (isUnaryExpr(parent) && relationalUnary.has(parent.op));
}

const logicalOps = new Set(['||', 'or', '&&', 'and', '<=>', 'iff', 'until', 'releases', 'since', 'triggered']);
const logicalUnary = new Set(['!', 'not', 'always', 'eventually', 'after', 'historically', 'once', 'before']);

/** Whether a name stands where only a formula can: an operand of a logical operator, a condition, a fact's or quantifier's body. */
function expectsFormula(node: AstNode): boolean {
    const parent = node.$container;
    if (isBinaryExpr(parent)) return logicalOps.has(parent.op);
    if (isUnaryExpr(parent)) return logicalUnary.has(parent.op);
    if (isImpliesExpr(parent)) return parent.condition === node;
    if (isQuantifiedExpr(parent)) return parent.quantifier !== 'sum' && parent.body === node;
    if (isSequenceExpr(parent)) return true;
    // One expression alone in a block may be a fun's value; several, or a fact's or pred's body, are formulas.
    if (isBlock(parent)) return parent.exprs.length > 1 || isFactDecl(parent.$container) || isPredDecl(parent.$container) || isAssertDecl(parent.$container);
    return false;
}

function isRestriction(node: AstNode | undefined): node is BinaryExpr {
    return isBinaryExpr(node) && (node.op === '<:' || node.op === ':>');
}

/** How many arguments a name receives when it is called with brackets, or undefined when it is not called. */
export function callArity(node: AstNode): number | undefined {
    if (!isNameExpr(node) && !isAtNameExpr(node)) {
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
