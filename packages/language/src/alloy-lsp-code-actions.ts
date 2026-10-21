import { CstUtils, DocumentValidator, type AstNode, type LangiumDocument, type LangiumDocuments } from 'langium';
import type { CodeActionProvider } from 'langium/lsp';
import { CodeActionKind, TextEdit, type CodeAction, type CodeActionParams, type Diagnostic, type Position } from 'vscode-languageserver';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { utilLibraryUri } from './alloy-lsp-modules.js';
import { callArity } from './alloy-lsp-linker.js';
import { moduleDeclarations } from './alloy-lsp-scope.js';
import { utilLibrary } from './builtin/util-library.js';
import { isAssertDecl, isCommand, type AssertDecl, type Specification } from './generated/ast.js';

/**
 * Quick fixes: open the util module that declares an unresolved name,
 * create a pred for an unresolved call, and add a check for an assertion
 * that no command checks.
 */
export class AlloyCodeActionProvider implements CodeActionProvider {

    protected readonly documents: LangiumDocuments;

    constructor(services: AlloyLspServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
    }

    getCodeActions(document: LangiumDocument, params: CodeActionParams): CodeAction[] {
        const spec = document.parseResult.value as Specification;
        const actions: CodeAction[] = [];
        for (const diagnostic of params.context.diagnostics) {
            const data = diagnostic.data as { code?: string, refText?: string } | undefined;
            if (data?.code !== DocumentValidator.LinkingError || !data.refText || data.refText.includes('/')) continue;
            for (const module of this.utilModulesDeclaring(data.refText)) {
                actions.push(this.openAction(document, spec, module, diagnostic));
            }
            const arity = callArity(nodeAt(document, diagnostic.range.start) ?? spec);
            if (arity !== undefined) {
                actions.push(this.stubPredAction(document, data.refText, arity, diagnostic));
            }
        }
        const assert = assertAt(document, params.range.start);
        if (assert?.name && !isChecked(spec, assert.name)) {
            actions.push(edit(`Add 'check ${assert.name}'`, document, endOf(document), `\ncheck ${assert.name}\n`));
        }
        return actions;
    }

    /** The util modules whose public declarations include `name`. */
    protected utilModulesDeclaring(name: string): string[] {
        return Object.keys(utilLibrary).filter(path => {
            const module = this.documents.getDocument(utilLibraryUri(path));
            return module && [...moduleDeclarations(module.parseResult.value as Specification, false)].some(d => d.name === name);
        });
    }

    protected openAction(document: LangiumDocument, spec: Specification, module: string, diagnostic: Diagnostic): CodeAction {
        const declaration = this.documents.getDocument(utilLibraryUri(module))?.parseResult.value as Specification | undefined;
        const params = declaration?.module?.params ?? [];
        const args = params.length > 0 ? `[${params.map(() => 'univ').join(', ')}]` : '';
        const last = spec.opens[spec.opens.length - 1] ?? spec.module;
        const at: Position = last?.$cstNode ? { line: last.$cstNode.range.end.line + 1, character: 0 } : { line: 0, character: 0 };
        return { ...edit(`Add 'open ${module}${args}'`, document, at, `open ${module}${args}\n`), diagnostics: [diagnostic], isPreferred: true };
    }

    protected stubPredAction(document: LangiumDocument, name: string, arity: number, diagnostic: Diagnostic): CodeAction {
        const params = arity > 0 ? `${Array.from({ length: arity }, (_, i) => `p${i + 1}`).join(', ')}: univ` : '';
        return { ...edit(`Create 'pred ${name}'`, document, endOf(document), `\npred ${name}[${params}] {\n}\n`), diagnostics: [diagnostic] };
    }
}

function edit(title: string, document: LangiumDocument, at: Position, text: string): CodeAction {
    return {
        title,
        kind: CodeActionKind.QuickFix,
        edit: { changes: { [document.uri.toString()]: [TextEdit.insert(at, text)] } }
    };
}

function endOf(document: LangiumDocument): Position {
    return document.textDocument.positionAt(document.textDocument.getText().length);
}

function nodeAt(document: LangiumDocument, position: Position): AstNode | undefined {
    const root = document.parseResult.value.$cstNode;
    return root && CstUtils.findLeafNodeAtOffset(root, document.textDocument.offsetAt(position))?.astNode;
}

function assertAt(document: LangiumDocument, position: Position): AssertDecl | undefined {
    for (let node = nodeAt(document, position); node; node = node.$container) {
        if (isAssertDecl(node)) return node;
    }
    return undefined;
}

function isChecked(spec: Specification, name: string): boolean {
    return spec.paragraphs.some(p => isCommand(p) && p.calls.some(c => c.kind === 'check' && c.target?.$refText === name));
}
