import { type AstNode } from 'langium';
import { AbstractSemanticTokenProvider, type SemanticTokenAcceptor } from 'langium/lsp';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver';
import {
    isAtNameExpr, isCommandCall, isDeclName, isEnumDecl, isEnumMember, isFunDecl, isLetBinding, isMacroDecl, isMacroParam,
    isModuleParam, isNameExpr, isPredDecl, isSigDecl, isSigName, isSigRef, isTypeScope
} from './generated/ast.js';

/** Alloy's own token modifier for mutable (`var`) sigs and fields. */
export const MUTABLE_MODIFIER = 'mutable';

/**
 * Colours declarations and the names that refer to them by what they are:
 * sigs, fields, parameters, variables, preds, funs, enums, macros. Mutable
 * sigs and fields carry the `mutable` modifier wherever they appear.
 */
export class AlloySemanticTokenProvider extends AbstractSemanticTokenProvider {

    override get tokenModifiers(): Record<string, number> {
        const modifiers = super.tokenModifiers;
        return { ...modifiers, [MUTABLE_MODIFIER]: 1 << Object.keys(modifiers).length };
    }

    protected highlightElement(node: AstNode, acceptor: SemanticTokenAcceptor): void {
        const declared = tokenFor(node);
        if (declared) {
            acceptor({ node, property: 'name', type: declared.type, modifier: [SemanticTokenModifiers.declaration, ...declared.modifiers] });
            return;
        }
        if (isNameExpr(node) || isAtNameExpr(node) || isSigRef(node)) {
            this.highlightReference(node, 'ref', node.ref?.ref, acceptor);
        } else if (isTypeScope(node)) {
            this.highlightReference(node, 'sig', node.sig?.ref, acceptor);
        } else if (isCommandCall(node)) {
            this.highlightReference(node, 'target', node.target?.ref, acceptor);
        }
    }

    protected highlightReference(node: AstNode, property: string, target: AstNode | undefined, acceptor: SemanticTokenAcceptor): void {
        const token = target && tokenFor(target);
        if (token) {
            acceptor({ node, property: property as never, type: token.type, modifier: token.modifiers });
        }
    }
}

/** The token type and modifiers of a declaration, or undefined for anything else. */
function tokenFor(node: AstNode): { type: string, modifiers: string[] } | undefined {
    if (isSigName(node)) return { type: SemanticTokenTypes.class, modifiers: node.$container.var ? [MUTABLE_MODIFIER] : [] };
    if (isDeclName(node)) {
        const decl = node.$container;
        const binder = decl.$container;
        if (isSigDecl(binder)) return { type: SemanticTokenTypes.property, modifiers: decl.var ? [MUTABLE_MODIFIER] : [] };
        if (isPredDecl(binder) || isFunDecl(binder)) return { type: SemanticTokenTypes.parameter, modifiers: [] };
        return { type: SemanticTokenTypes.variable, modifiers: [] };
    }
    if (isPredDecl(node)) return { type: SemanticTokenTypes.method, modifiers: [] };
    if (isFunDecl(node)) return { type: SemanticTokenTypes.function, modifiers: [] };
    if (isEnumDecl(node)) return { type: SemanticTokenTypes.enum, modifiers: [] };
    if (isEnumMember(node)) return { type: SemanticTokenTypes.enumMember, modifiers: [] };
    if (isMacroDecl(node)) return { type: SemanticTokenTypes.macro, modifiers: [] };
    if (isMacroParam(node)) return { type: SemanticTokenTypes.parameter, modifiers: [] };
    if (isModuleParam(node)) return { type: SemanticTokenTypes.typeParameter, modifiers: [] };
    if (isLetBinding(node)) return { type: SemanticTokenTypes.variable, modifiers: [] };
    return undefined;
}
