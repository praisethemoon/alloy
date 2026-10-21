import { AstUtils, type AstNode, type DocumentationProvider, type LangiumDocument } from 'langium';
import { AstNodeHoverProvider } from 'langium/lsp';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import type { AlloyModuleResolver } from './alloy-lsp-modules.js';
import { typeToString, type AlloyTypeSystem } from './alloy-lsp-types.js';
import {
    isAssertDecl, isDeclName, isEnumDecl, isEnumMember, isFunDecl, isLetBinding, isMacroDecl, isMacroParam,
    isModuleParam, isPredDecl, isSigDecl, isSigName, type SigDecl, type Specification
} from './generated/ast.js';

/**
 * Hovering a declaration or a name shows the declaration's header, its
 * inferred type, the module it comes from and its doc comment.
 */
export class AlloyHoverProvider extends AstNodeHoverProvider {

    protected readonly types: AlloyTypeSystem;
    protected readonly modules: AlloyModuleResolver;
    protected readonly documentation: DocumentationProvider;

    constructor(services: AlloyLspServices) {
        super(services);
        this.types = services.typing.TypeSystem;
        this.modules = services.references.ModuleResolver;
        this.documentation = services.documentation.DocumentationProvider;
    }

    protected getAstNodeHoverContent(node: AstNode): string | undefined {
        const header = declarationHeader(node);
        if (!header) return undefined;
        const parts = ['```alloy\n' + header + '\n```'];
        if (isSigName(node) || isDeclName(node) || isLetBinding(node) || isFunDecl(node)) {
            const type = this.types.typeOf(isFunDecl(node) ? node.returnType : node);
            if (type.kind !== 'unknown') parts.push(`type: \`${typeToString(type)}\``);
        }
        const document = AstUtils.getDocument(node) as LangiumDocument<Specification>;
        parts.push(`module \`${this.modules.modulePath(document)}\``);
        const doc = this.documentation.getDocumentation(commentHolder(node));
        if (doc) parts.push(doc);
        return parts.join('\n\n');
    }
}

/** Where a declaration's doc comment sits: before the whole sig or field declaration, not before its name. */
function commentHolder(node: AstNode): AstNode {
    if (isSigName(node) || isDeclName(node)) return node.$container;
    return node;
}

/** The declaration as Alloy source: its header without the body. */
export function declarationHeader(node: AstNode): string | undefined {
    if (isSigName(node)) return sigHeader(node.$container, node.name);
    if (isDeclName(node)) {
        const decl = node.$container;
        const bound = textOf(decl.type);
        const owner = decl.$container;
        if (isSigDecl(owner)) return `${decl.var ? 'var ' : ''}${owner.names.map(n => n.name).join(', ')}.${node.name}: ${bound}`;
        if (isPredDecl(owner) || isFunDecl(owner)) return `${node.name}: ${bound}  -- parameter of ${owner.name}`;
        return `${node.name}: ${bound}`;
    }
    if (isFunDecl(node) || isPredDecl(node) || isMacroDecl(node)) return headerBefore(node, node.body ?? (isMacroDecl(node) ? node.value : undefined));
    if (isEnumDecl(node)) return `enum ${node.name} { ${node.members.map(m => m.name).join(', ')} }`;
    if (isEnumMember(node)) return `${node.name}  -- member of enum ${node.$container.name}`;
    if (isAssertDecl(node)) return `assert ${node.name ?? node.label ?? ''}`.trim();
    if (isLetBinding(node)) return `let ${node.name} = ${textOf(node.value)}`;
    if (isMacroParam(node)) return `${node.name}  -- parameter of macro ${node.$container.name}`;
    if (isModuleParam(node)) return `${node.exactly ? 'exactly ' : ''}${node.name}  -- module parameter`;
    return undefined;
}

function sigHeader(sig: SigDecl, name: string): string {
    const qualifiers = [sig.private && 'private', sig.abstract && 'abstract', sig.var && 'var', sig.multiplicity].filter(Boolean).join(' ');
    const parent = sig.extends ? ` extends ${sig.extends.builtin ?? sig.extends.ref?.$refText}`
        : sig.in.length > 0 ? ` in ${sig.in.map(r => r.builtin ?? r.ref?.$refText).join(' + ')}`
        : sig.equals.length > 0 ? ` = ${sig.equals.map(r => r.builtin ?? r.ref?.$refText).join(' + ')}` : '';
    return `${qualifiers ? qualifiers + ' ' : ''}sig ${name}${parent}`;
}

/** The source text of a declaration up to where its body starts. */
function headerBefore(node: AstNode, body: AstNode | undefined): string | undefined {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    const text = AstUtils.getDocument(node).textDocument.getText();
    const end = body?.$cstNode ? body.$cstNode.offset : cst.end;
    return text.slice(cst.offset, end).replace(/\s*=?\s*$/, '').replace(/\s+/g, ' ');
}

function textOf(node: AstNode | undefined): string {
    return node?.$cstNode?.text.replace(/\s+/g, ' ') ?? '?';
}
