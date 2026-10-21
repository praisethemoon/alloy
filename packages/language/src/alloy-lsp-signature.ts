import { CstUtils, type AstNode, type CstNode, type LangiumDocument } from 'langium';
import type { SignatureHelpProvider } from 'langium/lsp';
import type { SignatureHelp, SignatureHelpOptions, SignatureHelpParams } from 'vscode-languageserver';
import { declarationHeader } from './alloy-lsp-hover.js';
import { isBoxJoinExpr, isFunDecl, isJoinExpr, isNameExpr, isPredDecl, type BoxJoinExpr, type FunDecl, type PredDecl } from './generated/ast.js';

/**
 * Inside the brackets of a pred or fun call, shows its declaration with the
 * current argument highlighted. In `x.f[y]` the receiver x is the first.
 */
export class AlloySignatureHelpProvider implements SignatureHelpProvider {

    get signatureHelpOptions(): SignatureHelpOptions {
        return { triggerCharacters: ['['], retriggerCharacters: [','] };
    }

    provideSignatureHelp(document: LangiumDocument, params: SignatureHelpParams): SignatureHelp | undefined {
        const root = document.parseResult.value.$cstNode;
        const offset = document.textDocument.offsetAt(params.position);
        const leaf = root && (CstUtils.findLeafNodeAtOffset(root, offset) ?? CstUtils.findLeafNodeAtOffset(root, offset - 1));
        for (let node: AstNode | undefined = leaf?.astNode; node; node = node.$container) {
            if (!isBoxJoinExpr(node) || !insideBrackets(node, offset)) continue;
            const call = calleeOfCall(node);
            if (!call) return undefined;
            return this.signature(call.callee, call.receiver ? 1 : 0, commasBefore(node, offset));
        }
        return undefined;
    }

    protected signature(callee: FunDecl | PredDecl, shift: number, commas: number): SignatureHelp {
        const parameters = [
            ...(callee.receiver ? [`this: ${callee.receiver.builtin ?? callee.receiver.ref?.$refText}`] : []),
            ...callee.params.flatMap(decl => decl.names.map(name => `${name.name}: ${decl.type.$cstNode?.text ?? '?'}`))
        ];
        return {
            signatures: [{ label: declarationHeader(callee) ?? callee.name, parameters: parameters.map(label => ({ label })) }],
            activeSignature: 0,
            activeParameter: Math.min(commas + shift, Math.max(parameters.length - 1, 0))
        };
    }
}

/** The pred or fun a box join calls, and whether it is called with a receiver (`x.f[y]`). */
function calleeOfCall(call: BoxJoinExpr): { callee: FunDecl | PredDecl, receiver: boolean } | undefined {
    const direct = isNameExpr(call.target) ? call.target.ref.ref : undefined;
    if (isFunDecl(direct) || isPredDecl(direct)) return { callee: direct, receiver: false };
    const viaJoin = isJoinExpr(call.target) && isNameExpr(call.target.right) ? call.target.right.ref.ref : undefined;
    if (isFunDecl(viaJoin) || isPredDecl(viaJoin)) return { callee: viaJoin, receiver: true };
    return undefined;
}

/** The call's own tokens (brackets and commas), not those of its target or arguments. */
function bracketTokens(call: BoxJoinExpr): CstNode[] {
    return call.$cstNode ? CstUtils.flattenCst(call.$cstNode).filter(leaf => leaf.astNode === call).toArray() : [];
}

function insideBrackets(call: BoxJoinExpr, offset: number): boolean {
    const tokens = bracketTokens(call);
    const open = tokens.find(t => t.text === '[');
    const close = [...tokens].reverse().find(t => t.text === ']');
    return !!open && open.offset < offset && (!close || offset <= close.offset);
}

function commasBefore(call: BoxJoinExpr, offset: number): number {
    return bracketTokens(call).filter(t => t.text === ',' && t.offset < offset).length;
}
