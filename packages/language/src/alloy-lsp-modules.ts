import { URI, UriUtils, WorkspaceCache, type LangiumDocument, type LangiumDocuments } from 'langium';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import type { Specification } from './generated/ast.js';
import { utilLibrary } from './builtin/util-library.js';

/** Documents of the bundled util library live under this scheme. */
export const UTIL_LIBRARY_SCHEME = 'alloy-lib';

export function utilLibraryUri(modulePath: string): URI {
    return URI.from({ scheme: UTIL_LIBRARY_SCHEME, path: `/${modulePath}.als` });
}

/** One `open` of a module, including the implicit `open util/integer as integer`. */
export interface ModuleImport {
    path: string;
    /** The prefix names from this module take: the `as` alias, else the path's last segment. */
    alias: string;
    document: LangiumDocument<Specification> | undefined;
}

/**
 * Finds the documents that `open` statements name, the way the Analyzer does:
 * a file relative to the importing module's root first, then the bundled
 * util library, then any workspace module declaring that path.
 */
export class AlloyModuleResolver {

    protected readonly documents: LangiumDocuments;
    protected readonly importsCache: WorkspaceCache<string, ModuleImport[]>;

    constructor(services: AlloyLspServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.importsCache = new WorkspaceCache(services.shared);
    }

    /** Every module the document opens, in order, with the implicit util/integer last. */
    imports(document: LangiumDocument<Specification>): ModuleImport[] {
        return this.importsCache.get(document.uri.toString(), () => {
            const spec = document.parseResult.value;
            const imports: ModuleImport[] = spec.opens.map(open => ({
                path: open.path,
                alias: open.alias ?? lastSegment(open.path),
                document: this.resolve(document, open.path)
            }));
            if (this.modulePath(document) !== 'util/integer' && !imports.some(i => i.path === 'util/integer')) {
                imports.push({ path: 'util/integer', alias: 'integer', document: this.resolve(document, 'util/integer') });
            }
            return imports;
        });
    }

    /** The module's declared path, or the file name without `.als` when it has no header. */
    modulePath(document: LangiumDocument<Specification>): string {
        return document.parseResult.value.module?.name
            ?? UriUtils.basename(document.uri).replace(/\.als$/, '');
    }

    resolve(from: LangiumDocument<Specification>, path: string): LangiumDocument<Specification> | undefined {
        const relative = UriUtils.joinPath(this.moduleRoot(from), `${path}.als`);
        if (this.documents.hasDocument(relative)) {
            return this.documents.getDocument(relative) as LangiumDocument<Specification>;
        }
        if (path in utilLibrary) {
            return this.documents.getDocument(utilLibraryUri(path)) as LangiumDocument<Specification> | undefined;
        }
        const declared = this.documents.all.find(doc =>
            doc.uri.scheme !== UTIL_LIBRARY_SCHEME
            && (doc.parseResult.value as Specification).module?.name === path);
        return declared as LangiumDocument<Specification> | undefined;
    }

    /**
     * The folder module paths are relative to: for `module a/b/c` in `.../a/b/c.als`
     * the folder holding `a`, otherwise the folder holding the file.
     */
    protected moduleRoot(document: LangiumDocument<Specification>): URI {
        let root = UriUtils.dirname(document.uri);
        const declared = document.parseResult.value.module?.name;
        if (declared) {
            const segments = declared.split('/');
            const dirs = segments.slice(0, -1).reverse();
            const fileMatches = UriUtils.basename(document.uri) === `${segments[segments.length - 1]}.als`;
            let candidate = root;
            let matches = fileMatches;
            for (const dir of dirs) {
                if (!matches || UriUtils.basename(candidate) !== dir) {
                    matches = false;
                    break;
                }
                candidate = UriUtils.dirname(candidate);
            }
            if (matches) {
                root = candidate;
            }
        }
        return root;
    }
}

function lastSegment(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}
