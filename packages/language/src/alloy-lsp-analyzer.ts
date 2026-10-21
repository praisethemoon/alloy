import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConfigurationProvider, LangiumDocument } from 'langium';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { isCommand, type CommandCall, type Specification } from './generated/ast.js';

/** What a finished command found. For a check, an instance is a counterexample. */
export type CommandOutcome = 'instance' | 'no-instance' | 'counterexample' | 'no-counterexample';

export interface CommandResult {
    /** The command's name in the Analyzer's receipt, e.g. the pred or assertion. */
    name?: string;
    kind?: 'run' | 'check';
    outcome?: CommandOutcome;
    /** Solving time in milliseconds, when the Analyzer reports it. */
    durationMs?: number;
    /** A readable table of the first instance or counterexample. */
    solutionFile?: string;
    /** Why the command could not be run; set instead of an outcome. */
    error?: string;
    /** Set when the solver was stopped by the timeout, so the editor can offer to change it. */
    timedOut?: boolean;
}

/** Settings under `alloy-lsp.analyzer`. */
export interface AnalyzerSettings {
    jar?: string;
    java?: string;
    timeoutSeconds?: number;
}

/** Every run and check of a document, in file order: the Analyzer's command indices. */
export function commandCalls(spec: Specification): CommandCall[] {
    return spec.paragraphs.filter(isCommand).flatMap(command => command.calls);
}

export function describeOutcome(result: CommandResult): string {
    if (result.error) return `error: ${result.error}`;
    const time = result.durationMs !== undefined ? ` (${result.durationMs} ms)` : '';
    switch (result.outcome) {
        case 'instance': return `instance found${time}`;
        case 'no-instance': return `no instance found${time}`;
        case 'counterexample': return `counterexample found${time}`;
        case 'no-counterexample': return `no counterexample found${time}`;
        default: return 'not run';
    }
}

/**
 * Runs commands through the official Alloy jar, headlessly, and remembers
 * each document's latest results until the document changes.
 */
export class AlloyAnalyzer {

    protected readonly configuration: ConfigurationProvider;
    protected readonly results = new Map<string, Map<number, CommandResult>>();
    /** The jar shipped with the editor extension, used when `alloy-lsp.analyzer.jar` is empty. */
    bundledJar?: string;

    constructor(services: AlloyLspServices) {
        this.configuration = services.shared.workspace.ConfigurationProvider;
        services.shared.workspace.DocumentBuilder.onUpdate(changed => changed.forEach(uri => this.results.delete(uri.toString())));
    }

    lastResult(document: LangiumDocument, index: number): CommandResult | undefined {
        return this.results.get(document.uri.toString())?.get(index);
    }

    async settings(): Promise<AnalyzerSettings> {
        const configured = (await this.configuration.getConfiguration('alloy-lsp', 'analyzer') ?? {}) as AnalyzerSettings;
        return {
            ...configured,
            jar: expandHome(configured.jar || undefined) ?? this.bundledJar,
            java: expandHome(configured.java || undefined)
        };
    }

    /** Runs the command with this index in the document's file and records the result. */
    async run(document: LangiumDocument, index: number): Promise<CommandResult> {
        const result = document.uri.scheme === 'file'
            ? await this.runFile(document.uri.fsPath, index)
            : { error: 'Only models saved as files can be run.' };
        const uri = document.uri.toString();
        if (!this.results.has(uri)) this.results.set(uri, new Map());
        this.results.get(uri)!.set(index, result);
        return result;
    }

    async runFile(file: string, index: number): Promise<CommandResult> {
        const settings = await this.settings();
        if (!settings.jar) {
            return { error: 'No Alloy jar: this editor ships none, so set alloy-lsp.analyzer.jar to an Alloy 6 jar.' };
        }
        try {
            await fs.access(settings.jar);
        } catch {
            return {
                error: settings.jar === this.bundledJar
                    ? `The shipped Alloy jar ${settings.jar} is missing; rebuild the extension (npm run fetch:alloy) or set alloy-lsp.analyzer.jar.`
                    : `The Alloy jar ${settings.jar} does not exist; check alloy-lsp.analyzer.jar.`
            };
        }
        const out = await fs.mkdtemp(path.join(os.tmpdir(), 'alloy-run-'));
        const args = ['-Djava.awt.headless=true', '-jar', settings.jar, 'exec', '-c', String(index), '-f', '-q', '-t', 'table', '-o', out, file];
        const timeoutSeconds = settings.timeoutSeconds ?? 300;
        const { code, stderr, timedOut } = await execute(settings.java || 'java', args, timeoutSeconds * 1000);
        if (timedOut) {
            return { error: `Stopped after ${timeoutSeconds} s, the alloy-lsp.analyzer.timeoutSeconds limit.`, timedOut: true };
        }
        if (code !== 0) {
            return { error: analyzerError(stderr) };
        }
        const receipt = JSON.parse(await fs.readFile(path.join(out, 'receipt.json'), 'utf-8')) as Receipt;
        const [name, entry] = Object.entries(receipt.commands)[0] ?? [];
        if (!name || !entry) return { error: 'The Analyzer ran no command.' };
        const solved = Array.isArray(entry.solution) && entry.solution.length > 0;
        const kind = entry.type === 'check' ? 'check' : 'run';
        const solutionFile = path.join(out, `${name}-solution-0.md`);
        return {
            name,
            kind,
            outcome: kind === 'check' ? (solved ? 'counterexample' : 'no-counterexample') : (solved ? 'instance' : 'no-instance'),
            durationMs: entry.solution?.[0]?.duration,
            solutionFile: solved && await exists(solutionFile) ? solutionFile : undefined
        };
    }
}

interface Receipt {
    commands: Record<string, { type?: string, solution?: Array<{ duration?: number }> }>;
}

/** Resolves a leading `~` to the home folder: java is started without a shell, which would do it. */
export function expandHome(file: string | undefined): string | undefined {
    if (file === '~') return os.homedir();
    return file?.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
}

/** The useful line of the Analyzer's error output, e.g. its syntax error and position. */
function analyzerError(stderr: string): string {
    const syntax = /(Syntax error in .* at line \d+ column \d+)/.exec(stderr);
    if (syntax) return syntax[1];
    const line = stderr.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('at '));
    return line ?? 'The Analyzer failed without a message.';
}

/** Runs a process to completion; a timeout of 0 or less waits as long as it takes. */
function execute(command: string, args: string[], timeoutMs: number): Promise<{ code: number, stderr: string, timedOut: boolean }> {
    return new Promise(resolve => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let timedOut = false;
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs) : undefined;
        child.on('error', error => { clearTimeout(timer); resolve({ code: -1, stderr: `Could not start ${command}: ${error.message}`, timedOut: false }); });
        child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stderr, timedOut }); });
    });
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}
