import { URI } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { createAlloyLspServices, describeOutcome, type CommandResult } from 'alloy-lsp-language';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared, AlloyLsp } = createAlloyLspServices({ connection, ...NodeFileSystem });

// The bundled util library has no files on disk; the client asks for a module's text to show it.
connection.onRequest('alloy/utilModule', (uri: string) =>
    shared.workspace.LangiumDocuments.getDocument(URI.parse(uri))?.textDocument.getText() ?? '');

// Runs one run/check through the Alloy jar, then has the client redraw the lenses with its outcome.
connection.onRequest('alloy/runCommand', async ({ uri, index }: { uri: string, index: number }): Promise<CommandResult & { summary: string }> => {
    const document = shared.workspace.LangiumDocuments.getDocument(URI.parse(uri));
    const result = document ? await AlloyLsp.analysis.Analyzer.run(document, index) : { error: `${uri} is not open in the language server.` };
    connection.sendRequest('workspace/codeLens/refresh').catch(() => undefined);
    return { ...result, summary: describeOutcome(result) };
});

// Start the language server with the shared services
startLanguageServer(shared);
