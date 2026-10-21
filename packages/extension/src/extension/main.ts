import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import { AlloySession, type CommandResult } from 'alloy-lsp-language';
import * as path from 'node:path';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';
import { AlloyRunner, CoreHighlight, sessionLaunch } from './analysis.js';
import { AlloyLogView } from './log-view.js';
import { VisualizerPanel } from './visualizer-panel.js';

let client: LanguageClient;

// This function is called when the extension is activated.
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    client = await startLanguageClient(context);
    // Definitions in the bundled util library open as read-only alloy-lib: documents.
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('alloy-lib', {
        provideTextDocumentContent: uri => client.sendRequest<string | undefined>('alloy/utilModule', uri.toString()).then(text => text ?? '')
    }));
    // Commands run in the editor's own session; outcomes go to the lenses and the log.
    const log = new AlloyLogView(context.extensionUri);
    const core = new CoreHighlight();
    const runner = new AlloyRunner(context, core, entry => log.add(entry),
        (uri, index, result: CommandResult) => client.sendNotification('alloy/commandOutcome', { uri, index, result }));
    log.runner = runner;
    context.subscriptions.push(core, runner, vscode.window.registerWebviewViewProvider(AlloyLogView.viewId, log, { webviewOptions: { retainContextWhenHidden: true } }));
    context.subscriptions.push(vscode.commands.registerCommand('alloy-lsp.runCommand', (uri: string, index: number) => runner.run(uri, index)));
    context.subscriptions.push(vscode.commands.registerCommand('alloy-lsp.setTimeout', changeRunTimeout));
    context.subscriptions.push(
        vscode.commands.registerCommand('alloy-lsp.clearCore', () => core.clear()),
        vscode.commands.registerCommand('alloy-lsp.showMetamodel', () => showMetamodel(context)),
        vscode.commands.registerCommand('alloy-lsp.openSampleModels', () => openSampleModels(context)));
    context.subscriptions.push(
        vscode.commands.registerCommand('alloy-lsp.visualize', (uri: string, index: number) =>
            VisualizerPanel.visualize(context.extensionUri, sessionLaunch(context), vscode.Uri.parse(uri).fsPath, index)),
        vscode.commands.registerCommand('alloy-lsp.showLatestInstance', () => {
            if (VisualizerPanel.latest) VisualizerPanel.latest.reveal();
            else vscode.window.showInformationMessage('Alloy: no instance has been visualized yet.');
        }),
        vscode.commands.registerCommand('alloy-lsp.openInstanceXml', async () => {
            const [file] = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Alloy instance': ['xml'] }, title: 'Open an Alloy instance' }) ?? [];
            if (file) await VisualizerPanel.openXml(context.extensionUri, sessionLaunch(context), file);
        }));
}

/** Shows the active model's sigs and fields in the visualizer, as the app's Show Metamodel. */
async function showMetamodel(context: vscode.ExtensionContext): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.languageId !== 'alloy-lsp' || document.uri.scheme !== 'file') {
        vscode.window.showInformationMessage('Alloy: open a saved Alloy model to show its metamodel.');
        return;
    }
    if (document.isDirty) await document.save();
    const launch = sessionLaunch(context);
    const session = new AlloySession(launch);
    try {
        const xml = await session.metamodel(document.uri.fsPath);
        VisualizerPanel.showXml(context.extensionUri, launch, xml, `Metamodel · ${path.basename(document.uri.fsPath)}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Alloy: ${(error as Error).message}`);
    } finally {
        session.dispose();
    }
}

/** Copies the sample models of the Alloy distribution into the extension's storage and lets one be opened, as the app's Open Sample Models. */
async function openSampleModels(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.Uri.joinPath(context.globalStorageUri, 'sample-models');
    const session = new AlloySession(sessionLaunch(context));
    try {
        await vscode.workspace.fs.createDirectory(folder);
        await session.extractModels(folder.fsPath);
    } catch (error) {
        vscode.window.showErrorMessage(`Alloy: ${(error as Error).message}`);
        return;
    } finally {
        session.dispose();
    }
    const [file] = await vscode.window.showOpenDialog({ defaultUri: folder, canSelectMany: false, filters: { 'Alloy model': ['als'] }, title: 'Open Sample Models' }) ?? [];
    if (file) await vscode.window.showTextDocument(file);
}

/** Asks for a new solver timeout, in seconds (0 for none), and saves it for the workspace or, with no folder open, for the user. */
async function changeRunTimeout(): Promise<void> {
    const settings = vscode.workspace.getConfiguration('alloy-lsp.analyzer');
    const current = settings.get<number>('timeoutSeconds', 300);
    const answer = await vscode.window.showInputBox({
        title: 'Alloy: run timeout',
        prompt: 'Seconds a run or check may take before it is stopped; 0 means no limit.',
        value: String(current),
        validateInput: text => /^\d+$/.test(text.trim()) ? undefined : 'Enter a whole number of seconds, 0 or more.'
    });
    if (answer === undefined) return;
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await settings.update('timeoutSeconds', Number(answer.trim()), target);
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
