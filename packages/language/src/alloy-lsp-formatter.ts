import { CstUtils, GrammarUtils, type AstNode, type CstNode } from 'langium';
import { AbstractFormatter, Formatting, type FormattingRegion, type NodeFormatter } from 'langium/lsp';
import {
    isArrowExpr, isBinaryExpr, isBlock, isBoxJoinExpr, isBuiltinCall, isComprehension, isDecl, isFunDecl, isImpliesExpr,
    isJoinExpr, isPredDecl, isPrimeExpr, isSequenceExpr, isSigDecl, isSpecification, isUnaryExpr, type SigDecl
} from './generated/ast.js';

const wordOperators = new Set(['no', 'some', 'lone', 'one', 'set', 'seq', 'sum', 'int', 'not', 'always', 'eventually', 'after', 'historically', 'once', 'before']);

/**
 * A light Alloy layout: one paragraph per line, multi-line blocks indented
 * one item per line, one-line blocks kept on one line, single spaces around
 * binary operators and after commas, and tight joins, brackets and primes.
 * Comments stay where they are.
 */
export class AlloyFormatter extends AbstractFormatter {

    protected format(node: AstNode): void {
        const f = this.getNodeFormatter(node);
        if (isSpecification(node)) {
            const items = [node.module, ...node.opens, ...node.paragraphs].filter((n): n is NonNullable<typeof n> => !!n)
                .sort((a, b) => (a.$cstNode?.offset ?? 0) - (b.$cstNode?.offset ?? 0));
            f.nodes(...items.slice(1)).prepend(Formatting.newLine({ allowMore: true }));
        } else if (isSigDecl(node)) {
            this.formatSigBody(node, f);
        } else if (isBlock(node)) {
            this.formatBraces(node, f, node.exprs);
        } else if (isDecl(node)) {
            f.keyword(':').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
        } else if (isBinaryExpr(node) || isImpliesExpr(node)) {
            spaceWithinLine(f.property('op'), GrammarUtils.findNodeForProperty(node.$cstNode, 'op'), true);
            if (isImpliesExpr(node)) spaceWithinLine(f.keyword('else'), GrammarUtils.findNodeForKeyword(node.$cstNode, 'else'), true);
        } else if (isArrowExpr(node)) {
            spaceWithinLine(f.keyword('->'), GrammarUtils.findNodeForKeyword(node.$cstNode, '->'), true);
        } else if (isSequenceExpr(node)) {
            f.keyword(';').prepend(Formatting.noSpace());
            spaceWithinLine(f.keyword(';'), GrammarUtils.findNodeForKeyword(node.$cstNode, ';'), false);
        } else if (isJoinExpr(node)) {
            f.keywords('.', '::').surround(Formatting.noSpace());
        } else if (isBoxJoinExpr(node) || isBuiltinCall(node)) {
            f.keyword('[').surround(Formatting.noSpace());
            f.keyword(']').prepend(Formatting.noSpace());
        } else if (isPrimeExpr(node)) {
            f.keywords("'", '‘', '’').prepend(Formatting.noSpace());
        } else if (isUnaryExpr(node)) {
            f.property('op').append(wordOperators.has(node.op) ? Formatting.oneSpace() : Formatting.noSpace());
        }
        if (isFunDecl(node) || isPredDecl(node)) {
            f.keywords('[', '(').append(Formatting.noSpace());
            f.keywords(']', ')').prepend(Formatting.noSpace());
        }
        if (isFunDecl(node) || isPredDecl(node) || isComprehension(node) || isBoxJoinExpr(node) || isBuiltinCall(node) || isSigDecl(node)) {
            const commas = f.keywords(',').prepend(Formatting.noSpace());
            // In a multi-line field list the item layout puts the next field (or its comment) on a new line.
            if (!(isSigDecl(node) && spansLines(node, '{', '}'))) {
                commas.append(Formatting.oneSpace());
            }
        }
    }

    /** A sig's field list: one field per indented line when it spans lines, else on one line. */
    protected formatSigBody(sig: SigDecl, f: NodeFormatter<SigDecl>): void {
        const open = f.keyword('{').prepend(Formatting.oneSpace());
        const close = f.keyword('}');
        if (sig.fields.length === 0) {
            open.append(Formatting.noSpace());
            return;
        }
        if (spansLines(sig, '{', '}')) {
            f.nodes(...sig.fields).prepend(Formatting.indent());
            this.indentOwnLineComments(f, [...sig.fields.map(field => field.$cstNode), GrammarUtils.findNodeForKeyword(sig.$cstNode, '}')]);
            close.prepend(Formatting.newLine());
        } else {
            open.append(Formatting.oneSpace());
            close.prepend(Formatting.oneSpace());
        }
    }

    /**
     * Langium formats a comment with no formatting of its own at the
     * enclosing indentation, which for our per-item indent is column 0. Give
     * each comment on its own line before one of `before` the items' indent;
     * a comment trailing a line stays where it is.
     */
    protected indentOwnLineComments(f: NodeFormatter<AstNode>, before: Array<CstNode | undefined>): void {
        const comments = before.flatMap(node => node ? ownLineCommentsBefore(node) : []);
        if (comments.length > 0) {
            f.cst(comments).prepend(Formatting.indent());
        }
    }

    /** A block's formulas: one per indented line when the block spans lines, else on one line. */
    protected formatBraces(node: AstNode, f: NodeFormatter<AstNode>, items: AstNode[]): void {
        const open = f.keyword('{').prepend(Formatting.oneSpace());
        const close = f.keyword('}');
        if (items.length === 0) {
            open.append(Formatting.noSpace());
            return;
        }
        if (spansLines(node, '{', '}')) {
            f.nodes(...items).prepend(Formatting.indent());
            this.indentOwnLineComments(f, [...items.map(item => item.$cstNode), GrammarUtils.findNodeForKeyword(node.$cstNode, '}')]);
            close.prepend(Formatting.newLine());
        } else {
            open.append(Formatting.oneSpace());
            close.prepend(Formatting.oneSpace());
        }
    }
}

/**
 * One space on each side of an operator (only after it when `before` is
 * false), but only where its neighbour is on the same line: a line break the
 * author put next to an operator stays.
 */
function spaceWithinLine(region: FormattingRegion, operator: CstNode | undefined, before: boolean): void {
    if (!operator) return;
    const previous = CstUtils.getPreviousNode(operator, false);
    const next = CstUtils.getNextNode(operator, false);
    if (before && previous && previous.range.end.line === operator.range.start.line) {
        region.prepend(Formatting.oneSpace());
    }
    if (next && next.range.start.line === operator.range.end.line) {
        region.append(Formatting.oneSpace());
    }
}

/** The comments directly before a node that start a line of their own. */
function ownLineCommentsBefore(node: CstNode): CstNode[] {
    const comments: CstNode[] = [];
    for (let previous = CstUtils.getPreviousNode(node, true); previous?.hidden; previous = CstUtils.getPreviousNode(previous, true)) {
        comments.unshift(previous);
    }
    return comments.filter(comment => {
        const before = CstUtils.getPreviousNode(comment, false);
        return !before || before.range.end.line < comment.range.start.line;
    });
}

/** Whether a node's braces sit on different lines. */
function spansLines(node: AstNode, open: string, close: string): boolean {
    const tokens = node.$cstNode ? CstUtils.flattenCst(node.$cstNode).filter(leaf => leaf.astNode === node).toArray() : [];
    const first = tokens.find(t => t.text === open);
    const last = [...tokens].reverse().find(t => t.text === close);
    return !!first && !!last && first.range.start.line !== last.range.start.line;
}
