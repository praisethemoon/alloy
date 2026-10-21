import { URI } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { createAlloyLspServices } from 'alloy-lsp-language';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared } = createAlloyLspServices({ connection, ...NodeFileSystem });

// The bundled util library has no files on disk; the client asks for a module's text to show it.
connection.onRequest('alloy/utilModule', (uri: string) =>
    shared.workspace.LangiumDocuments.getDocument(URI.parse(uri))?.textDocument.getText() ?? '');

// Start the language server with the shared services
startLanguageServer(shared);
