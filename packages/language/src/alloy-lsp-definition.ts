import { AstUtils, GrammarUtils, type CstNode, type LangiumDocument, type MaybePromise } from 'langium';
import { DefaultDefinitionProvider } from 'langium/lsp';
import { LocationLink, type DefinitionParams } from 'vscode-languageserver';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import type { AlloyModuleResolver } from './alloy-lsp-modules.js';
import { isOpen, type Specification } from './generated/ast.js';

/** Besides references, an `open` path leads to the module it names. */
export class AlloyDefinitionProvider extends DefaultDefinitionProvider {

    protected readonly modules: AlloyModuleResolver;

    constructor(services: AlloyLspServices) {
        super(services);
        this.modules = services.references.ModuleResolver;
    }

    protected override collectLocationLinks(sourceCstNode: CstNode, params: DefinitionParams): MaybePromise<LocationLink[] | undefined> {
        const open = sourceCstNode.astNode;
        if (isOpen(open)) {
            const path = GrammarUtils.findNodeForProperty(open.$cstNode, 'path');
            if (path && path.offset <= sourceCstNode.offset && sourceCstNode.end <= path.end) {
                const from = AstUtils.getDocument(open) as LangiumDocument<Specification>;
                const target = this.modules.resolve(from, open.path);
                const header = target?.parseResult.value.module?.$cstNode ?? target?.parseResult.value.$cstNode;
                if (target && header) {
                    return [LocationLink.create(target.uri.toString(), header.range, header.range, path.range)];
                }
            }
        }
        return super.collectLocationLinks(sourceCstNode, params);
    }
}
