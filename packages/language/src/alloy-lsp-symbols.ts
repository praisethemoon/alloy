import { type AstNode, type AstNodeDescription, type LangiumDocument } from 'langium';
import { DefaultNodeKindProvider, type DocumentSymbolProvider } from 'langium/lsp';
import { CompletionItemKind, SymbolKind, type DocumentSymbol, type Range } from 'vscode-languageserver';
import { isDeclName, isSigDecl, type Paragraph, type Specification } from './generated/ast.js';

const symbolKinds: Record<string, SymbolKind> = {
    SigName: SymbolKind.Class,
    ModuleParam: SymbolKind.TypeParameter,
    EnumDecl: SymbolKind.Enum,
    EnumMember: SymbolKind.EnumMember,
    PredDecl: SymbolKind.Method,
    FunDecl: SymbolKind.Function,
    AssertDecl: SymbolKind.Boolean,
    FactDecl: SymbolKind.Property,
    MacroDecl: SymbolKind.Constant,
    MacroParam: SymbolKind.Variable,
    LetBinding: SymbolKind.Variable,
    Command: SymbolKind.Event
};

const completionKinds: Record<string, CompletionItemKind> = {
    SigName: CompletionItemKind.Class,
    ModuleParam: CompletionItemKind.TypeParameter,
    EnumDecl: CompletionItemKind.Enum,
    EnumMember: CompletionItemKind.EnumMember,
    PredDecl: CompletionItemKind.Method,
    FunDecl: CompletionItemKind.Function,
    AssertDecl: CompletionItemKind.Value,
    MacroDecl: CompletionItemKind.Constant,
    MacroParam: CompletionItemKind.Variable,
    LetBinding: CompletionItemKind.Variable
};

/** Symbol and completion icons for Alloy declarations; fields differ from variables only by where they are declared. */
export class AlloyNodeKindProvider extends DefaultNodeKindProvider {

    override getSymbolKind(node: AstNode | AstNodeDescription): SymbolKind {
        const type = typeOf(node);
        if (type === 'DeclName') return isField(node) ? SymbolKind.Field : SymbolKind.Variable;
        return symbolKinds[type] ?? super.getSymbolKind(node);
    }

    override getCompletionItemKind(node: AstNode | AstNodeDescription): CompletionItemKind {
        const type = typeOf(node);
        if (type === 'DeclName') return isField(node) ? CompletionItemKind.Field : CompletionItemKind.Variable;
        return completionKinds[type] ?? super.getCompletionItemKind(node);
    }
}

function typeOf(node: AstNode | AstNodeDescription): string {
    return '$type' in node ? node.$type : node.type;
}

function isField(node: AstNode | AstNodeDescription): boolean {
    const ast = '$type' in node ? node : node.node;
    return isDeclName(ast) && isSigDecl(ast.$container.$container);
}

/**
 * The outline: one entry per sig name with its fields beneath, enums with
 * their members, preds, funs, facts, asserts, macros and commands.
 */
export class AlloyDocumentSymbolProvider implements DocumentSymbolProvider {

    getSymbols(document: LangiumDocument): DocumentSymbol[] {
        const spec = document.parseResult.value as Specification;
        return spec.paragraphs.flatMap(paragraph => this.paragraphSymbols(paragraph));
    }

    protected paragraphSymbols(paragraph: Paragraph): DocumentSymbol[] {
        const range = paragraph.$cstNode?.range;
        if (!range) return [];
        switch (paragraph.$type) {
            case 'SigDecl': {
                const fields = paragraph.fields.flatMap(decl => decl.names.map(name =>
                    symbol(name.name, SymbolKind.Field, decl.$cstNode?.range ?? range, name.$cstNode?.range, decl.type.$cstNode?.text)));
                return paragraph.names.map(name => ({
                    ...symbol(name.name, SymbolKind.Class, range, name.$cstNode?.range, sigDetail(paragraph)),
                    children: fields
                }));
            }
            case 'EnumDecl':
                return [{
                    ...symbol(paragraph.name, SymbolKind.Enum, range, paragraph.$cstNode?.range),
                    children: paragraph.members.map(m => symbol(m.name, SymbolKind.EnumMember, m.$cstNode?.range ?? range))
                }];
            case 'PredDecl':
            case 'FunDecl':
            case 'MacroDecl':
                return [symbol(paragraph.name, symbolKinds[paragraph.$type], range, undefined, undefined)];
            case 'FactDecl':
                return [symbol(paragraph.name ?? paragraph.label ?? 'fact', SymbolKind.Property, range)];
            case 'AssertDecl':
                return [symbol(paragraph.name ?? paragraph.label ?? 'assert', SymbolKind.Boolean, range)];
            case 'Command': {
                const call = paragraph.calls[0];
                const target = call?.target?.$refText ?? call?.name ?? '{…}';
                return [symbol(`${paragraph.label ? paragraph.label + ': ' : ''}${call?.kind ?? 'run'} ${target}`, SymbolKind.Event, range)];
            }
        }
    }
}

function sigDetail(sig: Paragraph & { $type: 'SigDecl' }): string | undefined {
    if (sig.extends) return `extends ${sig.extends.builtin ?? sig.extends.ref?.$refText}`;
    if (sig.in.length > 0) return `in ${sig.in.map(r => r.builtin ?? r.ref?.$refText).join(' + ')}`;
    return undefined;
}

function symbol(name: string, kind: SymbolKind, range: Range, selectionRange?: Range, detail?: string): DocumentSymbol {
    return { name, kind, range, selectionRange: selectionRange ?? range, detail };
}
