// Messages between the Alloy log view and the extension host.

/** One run, as the log shows it. */
export interface LogEntryView {
    id: number;
    time: string;
    file: string;
    /** E.g. `check NoIntruder`, or the command index when the run failed early. */
    title: string;
    solver: string;
    tone: 'found' | 'none' | 'error';
    text: string;
    /** `Instance` or `Counterexample` when there is one to open. */
    instance?: string;
    core: number;
    kodkod: boolean;
    warnings: Array<{ message: string, line?: number }>;
}

export type ToLog = { type: 'entries', entries: LogEntryView[] };

export type FromLog =
    | { type: 'ready' }
    | { type: 'instance', id: number }
    | { type: 'core', id: number }
    | { type: 'kodkod', id: number }
    | { type: 'warning', id: number, index: number }
    | { type: 'clear' };
