import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { AlloySession, type SessionLaunch, type SessionSolution } from 'alloy-lsp-language';
import type { FromWebview, SolutionMessage, ToWebview } from '../visualizer/protocol.js';

/**
 * A visualizer window, as the Alloy app opens one per instance: a webview
 * showing the solution, backed by a live session so Next, the trace moves and
 * the evaluator work; or, for an instance opened from an XML file, by none.
 */
export class VisualizerPanel {

    /** The panel shown last, for Show Latest Instance. */
    static latest: VisualizerPanel | undefined;

    protected ready = false;
    protected readonly queue: ToWebview[] = [];
    protected title: string;

    protected constructor(
        protected readonly panel: vscode.WebviewPanel,
        protected readonly extensionUri: vscode.Uri,
        protected readonly session: AlloySession | undefined,
        title: string
    ) {
        this.title = title;
        panel.webview.html = this.html();
        panel.webview.onDidReceiveMessage((message: FromWebview) => this.receive(message));
        panel.onDidDispose(() => {
            session?.dispose();
            if (VisualizerPanel.latest === this) VisualizerPanel.latest = undefined;
        });
        panel.onDidChangeViewState(event => {
            if (event.webviewPanel.visible) VisualizerPanel.latest = this;
        });
        VisualizerPanel.latest = this;
    }

    /**
     * Runs the command with this index in a new session and opens its
     * solution; reports instead when there is none to show.
     */
    static async visualize(extensionUri: vscode.Uri, launch: SessionLaunch, file: string, index: number): Promise<void> {
        const session = new AlloySession(launch);
        let solution: SessionSolution;
        try {
            solution = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Alloy: solving for the visualizer…' },
                () => session.run(file, index));
        } catch (error) {
            session.dispose();
            vscode.window.showErrorMessage(`Alloy: ${(error as Error).message}`);
            return;
        }
        if (!solution.satisfiable || !solution.xml) {
            session.dispose();
            vscode.window.showInformationMessage(`Alloy ${solution.kind} ${solution.command}: ${solution.kind === 'check' ? 'no counterexample' : 'no instance'} to visualize.`);
            return;
        }
        const title = `${solution.kind} ${solution.command} · ${path.basename(file)}`;
        const panel = new VisualizerPanel(VisualizerPanel.createWebview(extensionUri, title), extensionUri, session, title);
        panel.show(solution);
    }

    /** Opens an instance saved as XML; without a session, only its views and states can be explored. */
    static async openXml(extensionUri: vscode.Uri, file: vscode.Uri): Promise<void> {
        const xml = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
        const title = path.basename(file.fsPath);
        const panel = new VisualizerPanel(VisualizerPanel.createWebview(extensionUri, title), extensionUri, undefined, title);
        panel.post({ type: 'solution', xml, title, kind: 'run', live: false, incremental: false, newTraceAllowed: false });
    }

    reveal(): void {
        this.panel.reveal();
    }

    protected static createWebview(extensionUri: vscode.Uri, title: string): vscode.WebviewPanel {
        return vscode.window.createWebviewPanel('alloy-lsp.visualizer', `Alloy: ${title}`, vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out', 'webview')]
        });
    }

    protected show(solution: SessionSolution): void {
        const message: SolutionMessage = {
            type: 'solution',
            xml: solution.xml!,
            title: this.title,
            kind: solution.kind,
            live: !!this.session,
            incremental: solution.incremental,
            newTraceAllowed: solution.newTraceAllowed
        };
        this.post(message);
    }

    protected post(message: ToWebview): void {
        if (this.ready) {
            this.panel.webview.postMessage(message);
        } else {
            this.queue.push(message);
        }
    }

    protected async receive(message: FromWebview): Promise<void> {
        switch (message.type) {
            case 'ready':
                this.ready = true;
                this.queue.splice(0).forEach(m => this.panel.webview.postMessage(m));
                return;
            case 'move':
                return this.move(message.mode, message.state);
            case 'evaluate':
                return this.evaluate(message.id, message.expr, message.state);
        }
    }

    protected async move(mode: 'next' | 'config' | 'trace' | 'init' | 'fork', state?: number): Promise<void> {
        if (!this.session) return;
        this.post({ type: 'busy', busy: true });
        try {
            const solution = await this.session.move(mode, state);
            if (solution.satisfiable && solution.xml) {
                this.show(solution);
            } else {
                this.post({ type: 'error', message: 'There are no more satisfying instances.' });
            }
        } catch (error) {
            this.post({ type: 'error', message: (error as Error).message });
        } finally {
            this.post({ type: 'busy', busy: false });
        }
    }

    protected async evaluate(id: number, expr: string, state: number): Promise<void> {
        if (!this.session) {
            this.post({ type: 'evaluated', id, error: 'The evaluator needs a live solution; this instance was opened from a file.' });
            return;
        }
        try {
            this.post({ type: 'evaluated', id, value: await this.session.evaluate(expr, state) });
        } catch (error) {
            this.post({ type: 'evaluated', id, error: (error as Error).message });
        }
    }

    protected html(): string {
        const webview = this.panel.webview;
        const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', name));
        const nonce = crypto.randomBytes(16).toString('base64');
        // Graphviz runs as WebAssembly; the codicon font is inlined in baukasten's CSS.
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource} data:`,
            `img-src ${webview.cspSource} data:`,
            `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('visualizer.css')}">
<title>Alloy visualizer</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${asset('visualizer.js')}"></script>
</body>
</html>`;
    }
}
