import * as vscode from 'vscode';
import * as path from 'node:path';
import { AlloySession, expandHome, type CommandResult, type SessionLaunch, type SessionPosition, type SessionRunOptions, type SessionSolution } from 'alloy-lsp-language';
import { jvmArgsFrom, runOptionsFrom } from './options.js';
import { VisualizerPanel } from './visualizer-panel.js';

// Running commands as the Alloy app's Execute does: in a session of our own,
// with the app's options as settings, Stop, the unsat core in the editor, a
// log entry per run, and the solution handed to the visualizer as it is.

/** The run options the alloy-lsp.analyzer settings ask for. */
export function runOptions(): SessionRunOptions {
    const s = vscode.workspace.getConfiguration('alloy-lsp.analyzer');
    return runOptionsFrom((key, fallback) => s.get(key, fallback));
}

/** How the session starts: the configured java and jar (else the shipped one), the helper beside it, and the memory and stack settings. */
export function sessionLaunch(context: vscode.ExtensionContext): SessionLaunch {
    const s = vscode.workspace.getConfiguration('alloy-lsp.analyzer');
    return {
        java: expandHome(s.get<string>('java') || undefined),
        jar: expandHome(s.get<string>('jar') || undefined) ?? context.asAbsolutePath(path.join('alloy', 'alloy.jar')),
        sessionJar: context.asAbsolutePath(path.join('alloy', 'alloy-session.jar')),
        jvmArgs: jvmArgsFrom((key, fallback) => s.get(key, fallback))
    };
}

/** The outcome as the code lenses show it. */
export function toCommandResult(solution: SessionSolution): CommandResult {
    const outcome = solution.kind === 'check'
        ? (solution.satisfiable ? 'counterexample' : 'no-counterexample')
        : (solution.satisfiable ? 'instance' : 'no-instance');
    return { name: solution.command, kind: solution.kind, outcome, durationMs: solution.durationMs };
}

/** One run, as the log keeps it. */
export interface RunEntry {
    id: number;
    time: Date;
    file: string;
    index: number;
    command?: string;
    kind?: 'run' | 'check';
    solver: string;
    outcome?: CommandResult['outcome'];
    durationMs?: number;
    error?: string;
    warnings: Array<{ message: string, pos?: SessionPosition }>;
    core: SessionPosition[];
    kodkod?: string;
    /** The solution's XML, to show it again once its session is gone. */
    xml?: string;
}

/** The unsat core of the latest run, highlighted in its editors until the file changes. */
export class CoreHighlight implements vscode.Disposable {

    protected readonly decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editorError.foreground'),
        overviewRulerColor: new vscode.ThemeColor('editorError.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right
    });
    protected file: string | undefined;
    protected ranges: vscode.Range[] = [];
    protected readonly listeners: vscode.Disposable[];

    constructor() {
        this.listeners = [
            vscode.window.onDidChangeVisibleTextEditors(() => this.apply()),
            vscode.workspace.onDidChangeTextDocument(e => { if (e.document.uri.fsPath === this.file && e.contentChanges.length > 0) this.clear(); })
        ];
    }

    /** Highlights core positions (1-based, end inclusive) in the file they are in. */
    show(file: string, core: SessionPosition[]): void {
        this.file = file;
        this.ranges = core
            .filter(p => !p.file || path.resolve(p.file) === path.resolve(file))
            .map(p => new vscode.Range(p.line - 1, p.column - 1, p.endLine - 1, p.endColumn));
        this.apply();
    }

    clear(): void {
        this.file = undefined;
        this.ranges = [];
        this.apply();
    }

    protected apply(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.decoration, editor.document.uri.fsPath === this.file ? this.ranges : []);
        }
    }

    dispose(): void {
        this.decoration.dispose();
        this.listeners.forEach(l => l.dispose());
    }
}

/**
 * Runs commands as the app's Execute does. The latest run's session stays
 * alive until the next run, so its instance can still be opened live.
 */
export class AlloyRunner implements vscode.Disposable {

    protected latest: { entry: RunEntry, session: AlloySession, solution: SessionSolution } | undefined;
    protected nextId = 1;

    constructor(
        protected readonly context: vscode.ExtensionContext,
        protected readonly core: CoreHighlight,
        protected readonly onEntry: (entry: RunEntry) => void,
        protected readonly onOutcome: (uri: string, index: number, result: CommandResult) => void
    ) {}

    /** Runs the command with this index in the document, reporting as the app does. */
    async run(uri: string, index: number): Promise<RunEntry> {
        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
        if (document?.isDirty) await document.save();
        const file = vscode.Uri.parse(uri).fsPath;
        const options = runOptions();
        const entry: RunEntry = { id: this.nextId++, time: new Date(), file, index, solver: options.solver ?? 'sat4j', warnings: [], core: [] };
        this.release();
        this.core.clear();
        const session = new AlloySession(sessionLaunch(this.context));
        const timeoutSeconds = vscode.workspace.getConfiguration('alloy-lsp.analyzer').get<number>('timeoutSeconds', 300);
        let stopped: string | undefined;
        try {
            const solution = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Alloy: executing command ${index + 1} of ${path.basename(file)}…`, cancellable: true },
                (_progress, cancel) => {
                    const timer = timeoutSeconds > 0 ? setTimeout(() => {
                        stopped = `Stopped after ${timeoutSeconds} s, the alloy-lsp.analyzer.timeoutSeconds limit.`;
                        session.dispose();
                    }, timeoutSeconds * 1000) : undefined;
                    cancel.onCancellationRequested(() => { stopped = 'Stopped.'; session.dispose(); });
                    return session.run(file, index, options).finally(() => clearTimeout(timer));
                });
            Object.assign(entry, {
                command: solution.command, kind: solution.kind, outcome: toCommandResult(solution).outcome, durationMs: solution.durationMs,
                warnings: solution.warnings ?? [], core: solution.core ?? [], kodkod: solution.kodkod, xml: solution.xml
            });
            this.onOutcome(uri, index, toCommandResult(solution));
            if (solution.satisfiable) {
                this.latest = { entry, session, solution };
            } else {
                session.dispose();
                if (entry.core.length > 0) this.core.show(file, entry.core);
            }
            this.onEntry(entry);
            this.announce(entry);
        } catch (error) {
            session.dispose();
            entry.error = stopped ?? (error as Error).message;
            this.onOutcome(uri, index, { error: entry.error, timedOut: stopped?.startsWith('Stopped after') });
            this.onEntry(entry);
            const change = 'Change timeout';
            vscode.window.showErrorMessage(`Alloy: ${entry.error}`, ...(stopped?.startsWith('Stopped after') ? [change] : []))
                .then(choice => { if (choice === change) vscode.commands.executeCommand('alloy-lsp.setTimeout'); });
        }
        return entry;
    }

    /** Opens a logged run's solution: live while it is the latest run's, else from its XML. */
    showInstance(entry: RunEntry): void {
        const launch = sessionLaunch(this.context);
        if (this.latest?.entry.id === entry.id) {
            VisualizerPanel.adopt(this.context.extensionUri, launch, this.latest.session, this.latest.solution, entry.file);
            this.latest = undefined;
        } else if (entry.xml) {
            VisualizerPanel.showXml(this.context.extensionUri, launch, entry.xml, `${entry.kind} ${entry.command} · ${path.basename(entry.file)}`);
        }
    }

    showCore(entry: RunEntry): void {
        this.core.show(entry.file, entry.core);
        vscode.window.showTextDocument(vscode.Uri.file(entry.file), { preserveFocus: false });
    }

    protected announce(entry: RunEntry): void {
        const found = entry.outcome === 'instance' || entry.outcome === 'counterexample';
        const text = describeEntry(entry);
        if (found && vscode.workspace.getConfiguration('alloy-lsp.analyzer').get<boolean>('visualizeAutomatically', false)) {
            this.showInstance(entry);
            return;
        }
        const visualize = 'Visualize';
        const core = 'Show core';
        const show = entry.outcome === 'counterexample' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
        show(`Alloy ${entry.kind} ${entry.command}: ${text}`, ...(found ? [visualize] : []), ...(entry.core.length > 0 ? [core] : []))
            .then(choice => {
                if (choice === visualize) this.showInstance(entry);
                if (choice === core) this.showCore(entry);
            });
    }

    /** Lets go of the latest run's session, as a new run replaces it. */
    protected release(): void {
        this.latest?.session.dispose();
        this.latest = undefined;
    }

    dispose(): void {
        this.release();
    }
}

/** A run's outcome in words, as the app's log puts it. */
export function describeEntry(entry: RunEntry): string {
    if (entry.error) return entry.error;
    const time = entry.durationMs !== undefined ? ` ${entry.durationMs}ms.` : '';
    switch (entry.outcome) {
        case 'instance': return `Instance found. Predicate is consistent.${time}`;
        case 'no-instance': return `No instance found. Predicate may be inconsistent.${time}`;
        case 'counterexample': return `Counterexample found. Assertion is invalid.${time}`;
        case 'no-counterexample': return `No counterexample found. Assertion may be valid.${time}`;
        default: return '';
    }
}
