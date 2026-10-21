import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import type { CommandResult } from 'alloy-lsp-language';
import * as path from 'node:path';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

// This function is called when the extension is activated.
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    client = await startLanguageClient(context);
    // Definitions in the bundled util library open as read-only alloy-lib: documents.
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('alloy-lib', {
        provideTextDocumentContent: uri => client.sendRequest<string | undefined>('alloy/utilModule', uri.toString()).then(text => text ?? '')
    }));
    const output = vscode.window.createOutputChannel('Alloy');
    context.subscriptions.push(output, vscode.commands.registerCommand('alloy-lsp.runCommand', (uri: string, index: number) => runCommand(uri, index, output)));
}

/** Runs one run/check through the language server and reports its outcome, offering to open what it found. */
async function runCommand(uri: string, index: number, output: vscode.OutputChannel): Promise<void> {
    const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
    if (document?.isDirty) {
        await document.save();
    }
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Alloy: solving…' },
        () => client.sendRequest<CommandResult & { summary: string }>('alloy/runCommand', { uri, index }));
    const summary = result.summary;
    output.appendLine(`${new Date().toLocaleTimeString()} ${vscode.Uri.parse(uri).fsPath} command ${index}${result.name ? ` (${result.kind} ${result.name})` : ''}: ${summary}`);
    if (result.error) {
        void vscode.window.showErrorMessage(`Alloy: ${result.error}`);
        return;
    }
    const open = result.solutionFile ? (result.outcome === 'counterexample' ? 'Open counterexample' : 'Open instance') : undefined;
    const message = `Alloy ${result.kind} ${result.name}: ${summary}`;
    const show = result.outcome === 'counterexample' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const choice = await show(message, ...(open ? [open] : []));
    if (choice && result.solutionFile) {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(result.solutionFile)), { preview: true });
    }
}

// This function is called when the extension is deactivated.
export function deactivate(): Thenable<void> | undefined {
    if (client) {
        return client.stop();
    }
    return undefined;
}

async function startLanguageClient(context: vscode.ExtensionContext): Promise<LanguageClient> {
    const serverModule = context.asAbsolutePath(path.join('out', 'language', 'main.cjs'));
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging.
    // By setting `process.env.DEBUG_BREAK` to a truthy value, the language server will wait until a debugger is attached.
    const debugOptions = { execArgv: ['--nolazy', `--inspect${process.env.DEBUG_BREAK ? '-brk' : ''}=${process.env.DEBUG_SOCKET || '6009'}`] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: '*', language: 'alloy-lsp' }]
    };

    // Create the language client and start the client.
    const client = new LanguageClient(
        'alloy-lsp',
        'Alloy LSP',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    await client.start();
    return client;
}
