import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { FromLog, LogEntryView, ToLog } from '../visualizer/log-protocol.js';
import { describeEntry, type AlloyRunner, type RunEntry } from './analysis.js';

/**
 * The Alloy log, as the app's analyzer window shows it: one entry per run,
 * newest first, with links that open the instance or counterexample, show
 * the unsat core, open the recorded Kodkod program, and go to warnings.
 */
export class AlloyLogView implements vscode.WebviewViewProvider {

    static readonly viewId = 'alloy-lsp.log';

    protected view: vscode.WebviewView | undefined;
    protected readonly entries: RunEntry[] = [];
    runner: AlloyRunner | undefined;

    constructor(protected readonly extensionUri: vscode.Uri) {}

    add(entry: RunEntry): void {
        this.entries.unshift(entry);
        this.entries.splice(200);
        this.publish();
        this.view?.show(true);
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')] };
        view.webview.html = this.html(view.webview);
        view.webview.onDidReceiveMessage((message: FromLog) => this.receive(message));
        view.onDidDispose(() => { this.view = undefined; });
    }

    protected receive(message: FromLog): void {
        if (message.type === 'ready') return this.publish();
        if (message.type === 'clear') {
            this.entries.splice(0);
            return this.publish();
        }
        const entry = this.entries.find(e => e.id === message.id);
        if (!entry) return;
        switch (message.type) {
            case 'instance':
                this.runner?.showInstance(entry);
                return;
            case 'core':
                this.runner?.showCore(entry);
                return;
            case 'kodkod':
                vscode.workspace.openTextDocument({ language: 'java', content: entry.kodkod ?? '' })
                    .then(document => vscode.window.showTextDocument(document, { preview: true }));
                return;
            case 'warning': {
                const pos = entry.warnings[message.index]?.pos;
                const selection = pos ? new vscode.Range(pos.line - 1, pos.column - 1, pos.endLine - 1, pos.endColumn) : undefined;
                vscode.window.showTextDocument(vscode.Uri.file(pos?.file || entry.file), { selection });
                return;
            }
        }
    }

    protected publish(): void {
        const entries: LogEntryView[] = this.entries.map(e => ({
            id: e.id,
            time: e.time.toLocaleTimeString(),
            file: path.basename(e.file),
            title: e.command ? `${e.kind} ${e.command}` : `command ${e.index + 1}`,
            solver: e.solver,
            tone: e.error ? 'error' : e.outcome === 'instance' || e.outcome === 'counterexample' ? 'found' : 'none',
            text: describeEntry(e),
            instance: e.xml ? (e.kind === 'check' ? 'Counterexample' : 'Instance') : undefined,
            core: e.core.length,
            kodkod: !!e.kodkod,
            warnings: e.warnings.map(w => ({ message: w.message, line: w.pos?.line }))
        }));
        this.view?.webview.postMessage({ type: 'entries', entries } satisfies ToLog);
    }

    protected html(webview: vscode.Webview): string {
        const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', name));
        const nonce = crypto.randomBytes(16).toString('base64');
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource} data:`,
            `script-src 'nonce-${nonce}'`
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('log.css')}">
<title>Alloy log</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${asset('log.js')}"></script>
</body>
</html>`;
    }
}
