// Messages between the visualizer webview and the extension host.

/** The visualizer's ways to get another solution, as the app's buttons name them. */
export type Move = 'next' | 'config' | 'trace' | 'init' | 'fork';

/** What the panel shows: one solution and what may be asked of it. */
export interface SolutionMessage {
    type: 'solution';
    /** The Analyzer's instance XML, every state included. */
    xml: string;
    /** E.g. `run show` or `check noSelf`, for the title. */
    title: string;
    kind: 'run' | 'check';
    /** Whether a live session backs the panel: Next, the trace moves and the evaluator need one. */
    live: boolean;
    /** Whether the solver can enumerate (MiniSat and SAT4J). */
    incremental: boolean;
    /** False after New Init or New Fork, until New Config. */
    newTraceAllowed: boolean;
}

/** What the visualizer saves through the extension, as the app's File and Export menus do. */
export type SaveKind = 'theme' | 'dot' | 'xml' | 'predicate';

export type ToWebview =
    | SolutionMessage
    | { type: 'busy', busy: boolean }
    | { type: 'error', message: string }
    | { type: 'evaluated', id: number, value?: string, error?: string }
    | { type: 'theme', text: string, name: string };

export type FromWebview =
    | { type: 'ready' }
    | { type: 'move', mode: Move, state?: number }
    | { type: 'evaluate', id: number, expr: string, state: number }
    | { type: 'loadTheme' }
    | { type: 'loadSampleTheme' }
    /** Save As always asks where; Save reuses the theme's last file. */
    | { type: 'save', kind: SaveKind, text: string, saveAs: boolean };
