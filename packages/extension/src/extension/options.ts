import type { SessionRunOptions } from 'alloy-lsp-language';

// The alloy-lsp.analyzer settings as the solver's options (A4Options), with
// the app's choices mapped to its numbers. Kept free of the VS Code API so
// that it can be tested.

const MINIMIZATION: Record<string, number> = { slow: 0, medium: 1, fast: 2 };
const GRANULARITY: Record<string, number> = { 'top-level': 0, 'flatten-once': 1, 'flatten-twice': 2, 'expand-quantifiers': 3 };
const DECOMPOSE: Record<string, number> = { batch: 0, hybrid: 1, parallel: 2 };

/** Reads one setting, giving its default when unset. */
export type SettingReader = <T>(key: string, fallback: T) => T;

/** The run options the settings ask for. */
export function runOptionsFrom(get: SettingReader): SessionRunOptions {
    const recursion = get('recursionDepth', 0);
    return {
        solver: get('solver', 'sat4j'),
        skolemDepth: get('skolemDepth', 0),
        // Recursion depth 0 is the app's "disabled", which A4Options writes as -1 unrolls.
        unrolls: recursion > 0 ? recursion : -1,
        symmetry: get('symmetry', 20),
        noOverflow: get('preventOverflows', false),
        coreMinimization: MINIMIZATION[get('unsatCoreMinimization', 'fast')] ?? 2,
        coreGranularity: GRANULARITY[get('unsatCoreGranularity', 'top-level')] ?? 0,
        decompose: DECOMPOSE[get('decompose', 'batch')] ?? 0,
        inferPartialInstance: get('inferPartialInstance', true),
        recordKodkod: get('recordKodkod', false),
        allowWarnings: get('allowWarnings', true)
    };
}

/** The JVM options for the maximum memory (MB) and stack (KB) settings. */
export function jvmArgsFrom(get: SettingReader): string[] {
    const memory = get<number | null>('maxMemoryMB', null);
    const stack = get<number | null>('maxStackKB', null);
    return [...memory ? [`-Xmx${memory}m`] : [], ...stack ? [`-Xss${stack}k`] : []];
}
