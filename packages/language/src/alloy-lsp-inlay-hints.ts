import { GrammarUtils, type AstNode, type ConfigurationProvider, type LangiumDocument } from 'langium';
import { AbstractInlayHintProvider, type InlayHintAcceptor } from 'langium/lsp';
import { InlayHintKind, type InlayHint, type InlayHintParams } from 'vscode-languageserver';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { typeToString, type AlloyTypeSystem } from './alloy-lsp-types.js';
import { isDeclName, isLetBinding } from './generated/ast.js';

/** The language id under which settings arrive, and the section that turns hints off. */
const SETTINGS_LANGUAGE = 'alloy-lsp';

/**
 * Shows the inferred type after names whose type is not written down: let
 * bindings and names declared with `=`. Off when the client sets
 * `alloy-lsp.inlayHints.enabled` to false.
 */
export class AlloyInlayHintProvider extends AbstractInlayHintProvider {

    protected readonly types: AlloyTypeSystem;
    protected readonly configuration: ConfigurationProvider;

    constructor(services: AlloyLspServices) {
        super();
        this.types = services.typing.TypeSystem;
        this.configuration = services.shared.workspace.ConfigurationProvider;
    }

    override async getInlayHints(document: LangiumDocument, params: InlayHintParams): Promise<InlayHint[] | undefined> {
        const settings = await this.configuration.getConfiguration(SETTINGS_LANGUAGE, 'inlayHints');
        if (settings?.enabled === false) return [];
        return super.getInlayHints(document, params);
    }

    computeInlayHint(node: AstNode, acceptor: InlayHintAcceptor): void {
        const inferred = isLetBinding(node) || (isDeclName(node) && node.$container.defines);
        const end = GrammarUtils.findNodeForProperty(node.$cstNode, 'name')?.range.end;
        if (!inferred || !end) return;
        const type = this.types.typeOf(isLetBinding(node) ? node.value : node);
        if (type.kind === 'unknown') return;
        acceptor({ position: end, label: `: ${typeToString(type)}`, kind: InlayHintKind.Type, paddingLeft: false });
    }
}
