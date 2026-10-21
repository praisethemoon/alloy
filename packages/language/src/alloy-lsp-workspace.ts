import { DefaultWorkspaceManager, type LangiumDocument, type LangiumDocumentFactory, type LangiumSharedCoreServices, type WorkspaceFolder } from 'langium';
import { utilLibrary } from './builtin/util-library.js';
import { utilLibraryUri } from './alloy-lsp-modules.js';

/** Loads the bundled util library next to the workspace's own models. */
export class AlloyWorkspaceManager extends DefaultWorkspaceManager {

    protected readonly documentFactory: LangiumDocumentFactory;

    constructor(services: LangiumSharedCoreServices) {
        super(services);
        this.documentFactory = services.workspace.LangiumDocumentFactory;
    }

    protected override async loadAdditionalDocuments(_folders: WorkspaceFolder[], collector: (document: LangiumDocument) => void): Promise<void> {
        for (const [path, text] of Object.entries(utilLibrary)) {
            collector(this.documentFactory.fromString(text, utilLibraryUri(path)));
        }
    }
}
