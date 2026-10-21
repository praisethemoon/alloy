import { AstUtils, CstUtils, type AstNode, type LangiumDocument, type LangiumDocuments, type MaybePromise } from 'langium';
import { DefaultRenameProvider } from 'langium/lsp';
import { TextEdit, type Position, type Range, type RenameParams, type TextDocumentPositionParams, type WorkspaceEdit } from 'vscode-languageserver';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { UTIL_LIBRARY_SCHEME } from './alloy-lsp-modules.js';

/**
 * Renames a declaration and every use of it across modules, keeping a
 * qualifier such as `so/` or `this/` in front of qualified uses. Declarations
 * of the bundled util library cannot be renamed.
 */
export class AlloyRenameProvider extends DefaultRenameProvider {

    protected readonly documents: LangiumDocuments;

    constructor(services: AlloyLspServices) {
        super(services);
        this.documents = services.shared.workspace.LangiumDocuments;
    }

    override prepareRename(document: LangiumDocument, params: TextDocumentPositionParams): MaybePromise<Range | undefined> {
        const target = this.targetAt(document, params.position);
        return target && !inUtilLibrary(target) ? super.prepareRename(document, params) : undefined;
    }

    override async rename(document: LangiumDocument, params: RenameParams): Promise<WorkspaceEdit | undefined> {
        const target = this.targetAt(document, params.position);
        if (!target || inUtilLibrary(target)) return undefined;
        const changes: Record<string, TextEdit[]> = {};
        for (const reference of this.references.findReferences(target, { includeDeclaration: true })) {
            const source = this.documents.getDocument(reference.sourceUri);
            const text = source?.textDocument.getText(reference.segment.range) ?? '';
            const qualifier = text.slice(0, text.lastIndexOf('/') + 1);
            const uri = reference.sourceUri.toString();
            (changes[uri] ??= []).push(TextEdit.replace(reference.segment.range, qualifier + params.newName));
        }
        return { changes };
    }

    protected targetAt(document: LangiumDocument, position: Position): AstNode | undefined {
        const root = document.parseResult.value.$cstNode;
        const leaf = root && CstUtils.findDeclarationNodeAtOffset(root, document.textDocument.offsetAt(position), this.grammarConfig.nameRegexp);
        return leaf && this.references.findDeclarations(leaf)[0];
    }
}

function inUtilLibrary(node: AstNode): boolean {
    return AstUtils.getDocument(node).uri.scheme === UTIL_LIBRARY_SCHEME;
}
