import { CstUtils, GrammarAST, type AstNode, type CstNode, type AstNodeDescription, type AstNodeLocator, type LangiumDocuments, type MaybePromise, type ReferenceInfo, type Stream } from 'langium';
import { DefaultCompletionProvider, type CompletionAcceptor, type CompletionContext } from 'langium/lsp';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { overlaps, type AlloyTypeSystem } from './alloy-lsp-types.js';
import { isBoxJoinExpr, isDeclName, isExpr, isJoinExpr, isPrimeExpr, isSigDecl, isUnaryExpr, type SigDecl } from './generated/ast.js';

/** Paragraph templates offered next to their keyword. */
const snippets: Record<string, { body: string, detail: string }> = {
    sig: { body: 'sig ${1:Name} {\n\t${2}\n}', detail: 'signature' },
    pred: { body: 'pred ${1:name}[${2}] {\n\t${3}\n}', detail: 'predicate' },
    fun: { body: 'fun ${1:name}[${2}] : ${3:univ} {\n\t${4}\n}', detail: 'function' },
    fact: { body: 'fact ${1:name} {\n\t${2}\n}', detail: 'fact' },
    assert: { body: 'assert ${1:name} {\n\t${2}\n}', detail: 'assertion' },
    run: { body: 'run ${1:name} for ${2:3}', detail: 'run command' },
    check: { body: 'check ${1:name} for ${2:3}', detail: 'check command' }
};

/**
 * Completion that knows Alloy's types: after a dot it leaves out fields of
 * sigs the left side can never meet, and paragraph keywords come with a
 * template for the whole paragraph.
 */
export class AlloyCompletionProvider extends DefaultCompletionProvider {

    protected readonly types: AlloyTypeSystem;
    protected readonly documents: LangiumDocuments;
    protected readonly locator: AstNodeLocator;

    constructor(services: AlloyLspServices) {
        super(services);
        this.types = services.typing.TypeSystem;
        this.documents = services.shared.workspace.LangiumDocuments;
        this.locator = services.workspace.AstNodeLocator;
    }

    protected override getReferenceCandidates(refInfo: ReferenceInfo, context: CompletionContext): Stream<AstNodeDescription> {
        const candidates = super.getReferenceCandidates(refInfo, context);
        const left = this.expressionBeforeDot(context);
        if (!left) return candidates;
        const type = this.types.typeOf(left);
        if (type.kind !== 'relation') return candidates;
        const lastColumns = type.relations.map(r => r[r.length - 1]);
        return candidates.filter(description => {
            const owner = fieldOwner(this.load(description));
            return !owner || owner.names.some(sig => lastColumns.some(column => overlaps(column, sig)));
        });
    }

    protected override completionForKeyword(context: CompletionContext, keyword: GrammarAST.Keyword, acceptor: CompletionAcceptor): MaybePromise<void> {
        const snippet = snippets[keyword.value];
        if (snippet && this.filterKeyword(context, keyword)) {
            acceptor(context, {
                label: `${keyword.value} …`,
                kind: CompletionItemKind.Snippet,
                detail: snippet.detail,
                insertText: snippet.body,
                insertTextFormat: InsertTextFormat.Snippet,
                filterText: keyword.value,
                sortText: `1${keyword.value}`
            });
        }
        return super.completionForKeyword(context, keyword, acceptor);
    }

    /**
     * The left operand of a `.` just before the completion point: the
     * expression ending there, widened only through what binds tighter than
     * a join (joins, box joins, primes, ~ * ^), so `some a.` gives `a`.
     */
    protected expressionBeforeDot(context: CompletionContext): AstNode | undefined {
        const text = context.textDocument.getText();
        let dot = context.tokenOffset - 1;
        while (dot >= 0 && /\s/.test(text[dot])) dot--;
        if (text[dot] !== '.') return undefined;
        let end = dot;
        while (end > 0 && /\s/.test(text[end - 1])) end--;
        const root = context.document.parseResult.value.$cstNode;
        const leaf = root && CstUtils.findLeafNodeAtOffset(root, end - 1);
        let expr: AstNode | undefined = leaf?.astNode;
        if (!isExpr(expr)) return undefined;
        while (bindsTighterThanJoin(expr.$container) && expr.$container.$cstNode && expr.$container.$cstNode.end <= end) {
            expr = expr.$container;
        }
        return expr;
    }

    protected load(description: AstNodeDescription): AstNode | undefined {
        if (description.node) return description.node;
        const document = this.documents.getDocument(description.documentUri);
        return document && this.locator.getAstNode(document.parseResult.value, description.path);
    }
}

/** Joins, box joins, primes and ~ * ^: the expressions a following `.` applies to whole. */
function bindsTighterThanJoin(node: AstNode | undefined): node is AstNode & { $cstNode: CstNode } {
    if (isJoinExpr(node) || isBoxJoinExpr(node) || isPrimeExpr(node)) return true;
    return isUnaryExpr(node) && ['~', '*', '^'].includes(node.op);
}

function fieldOwner(node: AstNode | undefined): SigDecl | undefined {
    if (!isDeclName(node)) return undefined;
    const owner = node.$container.$container;
    return isSigDecl(owner) ? owner : undefined;
}
