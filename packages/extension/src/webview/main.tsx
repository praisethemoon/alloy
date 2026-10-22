import 'baukasten-ui/dist/baukasten-base.css';
import 'baukasten-ui/dist/baukasten-vscode.css';
import './visualizer.css';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Icon, IconButton, ProgressBar, Select } from 'baukasten-ui/core';
import { SplitPane, StatusBar, StatusBarItem, StatusBarSection } from 'baukasten-ui/extra';
import { columnNames, instanceToDot, themeName } from '../visualizer/dot.js';
import { instanceAsPredicate } from '../visualizer/export.js';
import { BUILTIN_SIGS, isTemporal, parseInstance, successor, type AlloyInstance, type AlloyState } from '../visualizer/instance.js';
import { magicLayout } from '../visualizer/magic.js';
import { projectionAtoms, projectState } from '../visualizer/projection.js';
import type { Move, SaveKind, SolutionMessage, ToWebview } from '../visualizer/protocol.js';
import { emptyTheme, parseTheme, writeTheme, type Theme } from '../visualizer/theme.js';
import { ThemePanel, type ThemeSubjects } from './ThemePanel.js';
import { Evaluator, type Evaluation } from './Evaluator.js';
import { host } from './host.js';
import { StateView, type ViewKind } from './StateView.js';
import { Toolbar } from './Toolbar.js';
import { TraceBar } from './TraceBar.js';

interface Saved {
    view: ViewKind;
    evaluatorOpen: boolean;
    theme?: Theme;
    themeName?: string;
}

/** What the theme panel can customise in a state: its sigs, sets and relations. */
function subjectsOf(state: AlloyState): ThemeSubjects {
    const sigName = (id: string) => { const sig = state.sigs.find(s => s.id === id); return sig ? themeName(sig) : id; };
    return {
        sigs: state.sigs.filter(s => s.subsetOf.length === 0 && s.label !== 'none').map(themeName).sort(),
        sets: [
            ...state.sigs.filter(s => s.subsetOf.length > 0 && !BUILTIN_SIGS.has(s.label)).map(s => ({ name: themeName(s), type: sigName(s.subsetOf[0]) })),
            ...state.skolems.filter(k => k.types.length === 1).map(k => ({ name: k.label, type: columnNames(state, k)[0] }))
        ],
        relations: [...state.fields, ...state.skolems].filter(r => r.types.length >= 2).map(r => ({ name: r.label, columns: columnNames(state, r) }))
    };
}

interface Shown {
    instance: AlloyInstance;
    meta: SolutionMessage;
}

function App() {
    const saved = (host.getState() as Saved | undefined) ?? { view: 'viz', evaluatorOpen: false };
    const [view, setView] = useState<ViewKind>(saved.view);
    const [evaluatorOpen, setEvaluatorOpen] = useState(saved.evaluatorOpen);
    const [theme, setTheme] = useState<Theme>(saved.theme ?? emptyTheme());
    const [themeLabel, setThemeLabel] = useState<string | undefined>(saved.themeName);
    const [themeOpen, setThemeOpen] = useState(false);
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [insert, setInsert] = useState<{ text: string, key: number }>();
    // Double-clicking an atom in the graph opens the evaluator with the atom's name, as the evaluator writes it (Node$1).
    const evaluateAtom = (atom: string) => {
        setEvaluatorOpen(true);
        setInsert({ text: atom, key: Date.now() });
    };
    const [shown, setShown] = useState<Shown>();
    const [focus, setFocus] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [nextId, setNextId] = useState(1);

    useEffect(() => { host.setState({ view, evaluatorOpen, theme, themeName: themeLabel } satisfies Saved); }, [view, evaluatorOpen, theme, themeLabel]);

    useEffect(() => {
        const receive = (event: MessageEvent<ToWebview>) => {
            const message = event.data;
            switch (message.type) {
                case 'solution':
                    try {
                        setShown({ instance: parseInstance(message.xml), meta: message });
                        setFocus(0);
                        setError(undefined);
                    } catch (e) {
                        setError(`This instance can't be read: ${(e as Error).message}`);
                    }
                    return;
                case 'busy':
                    setBusy(message.busy);
                    return;
                case 'error':
                    setError(message.message);
                    return;
                case 'evaluated':
                    setEvaluations(list => list.map(e => e.id === message.id ? { ...e, value: message.value, error: message.error } : e));
                    return;
                case 'theme':
                    try {
                        setTheme(parseTheme(message.text));
                        setThemeLabel(message.name);
                    } catch (e) {
                        setError(`${message.name} can't be loaded: ${(e as Error).message}`);
                    }
                    return;
            }
        };
        window.addEventListener('message', receive);
        host.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', receive);
    }, []);

    const instance = shown?.instance;
    const temporal = !!instance && isTemporal(instance);

    const move = useCallback((mode: Move) => {
        setError(undefined);
        host.postMessage({ type: 'move', mode, state: mode === 'fork' ? focus : undefined });
    }, [focus]);

    const evaluate = (expr: string) => {
        const id = nextId;
        setNextId(id + 1);
        setEvaluations(list => [...list, { id, expr, state: focus }]);
        host.postMessage({ type: 'evaluate', id, expr, state: focus });
    };

    if (!shown || !instance) {
        return (
            <div className="alloy-app">
                {error ? <Alert variant="error">{error}</Alert> : <div className="alloy-empty">Waiting for an instance…</div>}
            </div>
        );
    }

    const { meta } = shown;
    const next = successor(instance, focus);
    const focused = instance.states[focus];
    // Each projected sig shows one of its atoms; the first until another is picked.
    const projected = theme.projection.filter(t => projectionAtoms(focused, t).length > 0);
    const shownPicks = Object.fromEntries(projected.map(t => {
        const atoms = projectionAtoms(focused, t);
        return [t, atoms.includes(picks[t]) ? picks[t] : atoms[0]];
    }));
    const pickStep = (type: string, delta: number) => {
        const atoms = projectionAtoms(focused, type);
        const at = atoms.indexOf(shownPicks[type]);
        setPicks(p => ({ ...p, [type]: atoms[Math.min(atoms.length - 1, Math.max(0, at + delta))] }));
    };
    const exportAs = (kind: Exclude<SaveKind, 'theme'>) => {
        const text = kind === 'xml' ? meta.xml
            : kind === 'dot' ? instanceToDot(projectState(focused, shownPicks), theme)
                : instanceAsPredicate(focused);
        host.postMessage({ type: 'save', kind, text, saveAs: true });
    };
    const magic = () => {
        setTheme(magicLayout(focused, temporal));
        setThemeLabel(undefined);
    };
    const noEnumeration = !meta.live ? 'Opened from a file: there is no solver to ask for more.'
        : !meta.incremental ? 'This solver can\'t enumerate solutions; use SAT4J or MiniSat.'
            : undefined;

    const states = temporal
        ? (
            <SplitPane orientation="horizontal">
                <SplitPane.Pane preferredSize={0.5} minSize={160}>
                    <div className="alloy-state">
                        <div className="alloy-state-title">State {focus}</div>
                        <div className="alloy-state-body"><StateView state={instance.states[focus]} view={view} theme={theme} picks={shownPicks} onAtom={evaluateAtom} /></div>
                    </div>
                </SplitPane.Pane>
                <SplitPane.Pane minSize={160}>
                    <div className="alloy-state">
                        <div className="alloy-state-title">State {next}{next <= focus ? ' (loop)' : ''}</div>
                        <div className="alloy-state-body"><StateView state={instance.states[next]} view={view} theme={theme} picks={shownPicks} onAtom={evaluateAtom} /></div>
                    </div>
                </SplitPane.Pane>
            </SplitPane>
        )
        : <StateView state={instance.states[0]} view={view} theme={theme} picks={shownPicks} onAtom={evaluateAtom} />;

    return (
        <div className="alloy-app">
            <Toolbar
                view={view}
                onView={setView}
                temporal={temporal}
                noEnumeration={noEnumeration}
                newTraceAllowed={meta.newTraceAllowed}
                busy={busy}
                onMove={move}
                canPrevious={focus > 0}
                onPrevious={() => setFocus(f => Math.max(0, f - 1))}
                onNext={() => setFocus(f => successor(instance, f))}
                evaluatorOpen={evaluatorOpen}
                onToggleEvaluator={() => setEvaluatorOpen(open => !open)}
                themeOpen={themeOpen}
                onToggleTheme={() => setThemeOpen(open => !open)}
                onMagic={magic}
                onExport={exportAs}
            />
            {busy ? <ProgressBar variant="primary" height="2px" aria-label="Solving" /> : <div className="alloy-progress-space" />}
            {error && <Alert variant="error" closable onClose={() => setError(undefined)}>{error}</Alert>}
            {projected.length > 0 && (
                <div className="alloy-projection" role="group" aria-label="Projection">
                    <span className="alloy-muted">Projected over</span>
                    {projected.map(type => (
                        <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--bk-gap-xs)' }}>
                            <strong>{type}</strong>
                            <IconButton size="xs" variant="ghost" icon={<Icon name="chevron-left" />} aria-label={`Previous ${type}`} onClick={() => pickStep(type, -1)} />
                            <Select size="sm" options={projectionAtoms(focused, type).map(a => ({ value: a, label: a.replace('$', '') }))}
                                value={shownPicks[type]} onChange={atom => setPicks(p => ({ ...p, [type]: atom }))} />
                            <IconButton size="xs" variant="ghost" icon={<Icon name="chevron-right" />} aria-label={`Next ${type}`} onClick={() => pickStep(type, 1)} />
                        </span>
                    ))}
                </div>
            )}
            {temporal && (
                <div className="alloy-trace-row">
                    <TraceBar instance={instance} focus={focus} onFocus={setFocus} />
                </div>
            )}
            <div className="alloy-content">
                {evaluatorOpen
                    ? (
                        <SplitPane orientation="vertical">
                            <SplitPane.Pane minSize={120}>{states}</SplitPane.Pane>
                            <SplitPane.Pane preferredSize={0.35} minSize={120}>
                                <Evaluator
                                    evaluations={evaluations}
                                    temporal={temporal}
                                    focus={focus}
                                    disabled={meta.live ? undefined : 'Opened from a file: there is no solver to evaluate with.'}
                                    insert={insert}
                                    onEvaluate={evaluate}
                                    onClear={() => setEvaluations([])}
                                    onClose={() => setEvaluatorOpen(false)}
                                />
                            </SplitPane.Pane>
                        </SplitPane>
                    )
                    : states}
            </div>
            <ThemePanel
                open={themeOpen}
                theme={theme}
                themeName={themeLabel}
                subjects={subjectsOf(focused)}
                onChange={setTheme}
                onMagic={magic}
                onReset={() => { setTheme(emptyTheme()); setThemeLabel(undefined); }}
                onLoad={() => host.postMessage({ type: 'loadTheme' })}
                onLoadSample={() => host.postMessage({ type: 'loadSampleTheme' })}
                onSave={saveAs => host.postMessage({ type: 'save', kind: 'theme', text: writeTheme(theme), saveAs })}
                onClose={() => setThemeOpen(false)}
            />
            <StatusBar>
                <StatusBarSection align="left">
                    <StatusBarItem>{meta.title}</StatusBarItem>
                </StatusBarSection>
                <StatusBarSection align="right">
                    {temporal && <StatusBarItem>{`State ${focus} of ${instance.traceLength}, loops back to ${instance.loopState}`}</StatusBarItem>}
                    <StatusBarItem>{instance.command}</StatusBarItem>
                </StatusBarSection>
            </StatusBar>
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<App />);
