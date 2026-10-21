import * as path from 'node:path';
import { URI } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { createAlloyLspServices, describeOutcome, type CommandResult } from 'alloy-lsp-language';

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared, AlloyLsp } = createAlloyLspServices({ connection, ...NodeFileSystem });

// The jar this extension ships, from out/language/ up to alloy/; used when alloy-lsp.analyzer.jar is empty.
AlloyLsp.analysis.Analyzer.bundledJar = path.resolve(__dirname, '../../alloy/alloy.jar');

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

// Runs made by the editor's own session report their outcome here, for the lenses.
connection.onNotification('alloy/commandOutcome', ({ uri, index, result }: { uri: string, index: number, result: CommandResult }) => {
    AlloyLsp.analysis.Analyzer.record(uri, index, result);
    connection.sendRequest('workspace/codeLens/refresh').catch(() => undefined);
});

// Start the language server with the shared services
startLanguageServer(shared);
