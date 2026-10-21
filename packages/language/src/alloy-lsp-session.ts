import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';

/** A source range the Analyzer reports, 1-based. */
export interface SessionPosition {
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
}

/** A solution as the session describes it after a run or a trace move. */
export interface SessionSolution {
    command: string;
    kind: 'run' | 'check';
    satisfiable: boolean;
    /** Whether the solver can enumerate further solutions (MiniSat and SAT4J). */
    incremental: boolean;
    /** False after New Init or New Fork, until New Config: the app disables New Trace then. */
    newTraceAllowed: boolean;
    /** The instance as the Alloy app's XML, every state of the trace included. */
    xml?: string;
    traceLength?: number;
    /** The state the trace loops back to. */
    loopState?: number;
    /** For an unsatisfiable command, the unsat core, when the solver reports one. */
    core?: SessionPosition[];
    durationMs?: number;
}

/** Options of a run, as the app's Options menu has them. */
export interface SessionRunOptions {
    solver?: string;
    skolemDepth?: number;
    unrolls?: number;
    symmetry?: number;
    noOverflow?: boolean;
    coreMinimization?: number;
    coreGranularity?: number;
    inferPartialInstance?: boolean;
    decompose?: number;
    recordKodkod?: boolean;
}

/** The visualizer's ways to get another solution. */
export type SessionMove = 'next' | 'config' | 'trace' | 'init' | 'fork';

export class SessionError extends Error {
    constructor(message: string, readonly pos?: SessionPosition) {
        super(message);
    }
}

/** How to start the helper: java, the Alloy jar, and the helper jar built against it. */
export interface SessionLaunch {
    java?: string;
    jar: string;
    sessionJar: string;
}

/**
 * A live Alloy session in a Java helper process (packages/extension/java):
 * it keeps the latest solution, so the visualizer can step through solutions,
 * trace moves and evaluations as the Alloy app does. Requests are queued in
 * order; a helper that dies rejects what is pending and is restarted on the
 * next request.
 */
export class AlloySession {

    protected process?: ChildProcessWithoutNullStreams;
    protected nextId = 1;
    protected readonly pending = new Map<number, { resolve: (reply: Record<string, unknown>) => void, reject: (error: Error) => void }>();
    protected stderr = '';

    constructor(protected readonly launch: SessionLaunch) {}

    run(file: string, command: number, options: SessionRunOptions = {}): Promise<SessionSolution> {
        return this.request({ op: 'run', file, command, ...options }) as Promise<unknown> as Promise<SessionSolution>;
    }

    /** Next, New Config, New Trace, New Init, or New Fork from `state`. */
    move(mode: SessionMove, state?: number): Promise<SessionSolution> {
        return this.request({ op: 'next', mode, state }) as Promise<unknown> as Promise<SessionSolution>;
    }

    async evaluate(expr: string, state = 0): Promise<string> {
        return (await this.request({ op: 'eval', expr, state })).value as string;
    }

    /** The model's sigs and fields as instance XML, for Show Metamodel. */
    async metamodel(): Promise<string> {
        return (await this.request({ op: 'metamodel' })).xml as string;
    }

    dispose(): void {
        this.process?.kill();
        this.process = undefined;
    }

    protected request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
        const child = this.process ?? this.start();
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            child.stdin.write(JSON.stringify({ id, ...body }) + '\n');
        });
    }

    protected start(): ChildProcessWithoutNullStreams {
        const classpath = [this.launch.jar, this.launch.sessionJar].join(path.delimiter);
        const child = spawn(this.launch.java || 'java', ['-Djava.awt.headless=true', '-cp', classpath, 'alloylsp.AlloySession']);
        this.process = child;
        this.stderr = '';
        child.stderr.on('data', chunk => this.stderr = (this.stderr + chunk).slice(-4000));
        // A write to a helper that has just died fails here; its exit rejects the request.
        child.stdin.on('error', () => undefined);
        readline.createInterface({ input: child.stdout }).on('line', line => this.receive(line));
        const fail = (error: Error) => {
            if (this.process === child) this.process = undefined;
            for (const { reject } of this.pending.values()) reject(error);
            this.pending.clear();
        };
        child.on('error', error => fail(new SessionError(`Could not start the Alloy session (${this.launch.java || 'java'}): ${error.message}`)));
        child.on('exit', code => fail(new SessionError(`The Alloy session stopped (exit code ${code}). ${lastLine(this.stderr)}`.trim())));
        return child;
    }

    protected receive(line: string): void {
        let reply: Record<string, unknown>;
        try {
            reply = JSON.parse(line);
        } catch {
            return;
        }
        const waiting = this.pending.get(reply.id as number);
        if (!waiting) return;
        this.pending.delete(reply.id as number);
        if (reply.ok) {
            waiting.resolve(reply);
        } else {
            waiting.reject(new SessionError(String(reply.error), reply.pos as SessionPosition | undefined));
        }
    }
}

function lastLine(text: string): string {
    return text.trim().split('\n').at(-1) ?? '';
}
