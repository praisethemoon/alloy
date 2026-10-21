import { CstUtils, type AstNode } from 'langium';
import { AbstractFormatter, Formatting, type NodeFormatter } from 'langium/lsp';
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
            f.property('op').surround(Formatting.oneSpace());
            if (isImpliesExpr(node)) f.keyword('else').surround(Formatting.oneSpace());
        } else if (isArrowExpr(node)) {
            f.keyword('->').surround(Formatting.oneSpace());
        } else if (isSequenceExpr(node)) {
            f.keyword(';').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
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
            f.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
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
            f.property('fields').prepend(Formatting.indent());
            close.prepend(Formatting.newLine());
        } else {
            open.append(Formatting.oneSpace());
            close.prepend(Formatting.oneSpace());
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
            close.prepend(Formatting.newLine());
        } else {
            open.append(Formatting.oneSpace());
            close.prepend(Formatting.oneSpace());
        }
    }
}

/** Whether a node's braces sit on different lines. */
function spansLines(node: AstNode, open: string, close: string): boolean {
    const tokens = node.$cstNode ? CstUtils.flattenCst(node.$cstNode).filter(leaf => leaf.astNode === node).toArray() : [];
    const first = tokens.find(t => t.text === open);
    const last = [...tokens].reverse().find(t => t.text === close);
    return !!first && !!last && first.range.start.line !== last.range.start.line;
}
