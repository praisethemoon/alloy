import 'baukasten-ui/dist/baukasten-base.css';
import 'baukasten-ui/dist/baukasten-vscode.css';
import './visualizer.css';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, ProgressBar } from 'baukasten-ui/core';
import { SplitPane, StatusBar, StatusBarItem, StatusBarSection } from 'baukasten-ui/extra';
import { isTemporal, parseInstance, successor, type AlloyInstance } from '../visualizer/instance.js';
import type { Move, SolutionMessage, ToWebview } from '../visualizer/protocol.js';
import { Evaluator, type Evaluation } from './Evaluator.js';
import { host } from './host.js';
import { StateView, type ViewKind } from './StateView.js';
import { Toolbar } from './Toolbar.js';
import { TraceBar } from './TraceBar.js';

interface Saved {
    view: ViewKind;
    evaluatorOpen: boolean;
}

interface Shown {
    instance: AlloyInstance;
    meta: SolutionMessage;
}

function App() {
    const saved = (host.getState() as Saved | undefined) ?? { view: 'viz', evaluatorOpen: false };
    const [view, setView] = useState<ViewKind>(saved.view);
    const [evaluatorOpen, setEvaluatorOpen] = useState(saved.evaluatorOpen);
    const [shown, setShown] = useState<Shown>();
    const [focus, setFocus] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
    const [nextId, setNextId] = useState(1);

    useEffect(() => { host.setState({ view, evaluatorOpen } satisfies Saved); }, [view, evaluatorOpen]);

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
    const noEnumeration = !meta.live ? 'Opened from a file: there is no solver to ask for more.'
        : !meta.incremental ? 'This solver can\'t enumerate solutions; use SAT4J or MiniSat.'
            : undefined;

    const states = temporal
        ? (
            <SplitPane orientation="horizontal">
                <SplitPane.Pane preferredSize={0.5} minSize={160}>
                    <div className="alloy-state">
                        <div className="alloy-state-title">State {focus}</div>
                        <div className="alloy-state-body"><StateView state={instance.states[focus]} view={view} /></div>
                    </div>
                </SplitPane.Pane>
                <SplitPane.Pane minSize={160}>
                    <div className="alloy-state">
                        <div className="alloy-state-title">State {next}{next <= focus ? ' (loop)' : ''}</div>
                        <div className="alloy-state-body"><StateView state={instance.states[next]} view={view} /></div>
                    </div>
                </SplitPane.Pane>
            </SplitPane>
        )
        : <StateView state={instance.states[0]} view={view} />;

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
            />
            {busy ? <ProgressBar variant="primary" height="2px" aria-label="Solving" /> : <div className="alloy-progress-space" />}
            {error && <Alert variant="error" closable onClose={() => setError(undefined)}>{error}</Alert>}
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
                                    onEvaluate={evaluate}
                                    onClear={() => setEvaluations([])}
                                    onClose={() => setEvaluatorOpen(false)}
                                />
                            </SplitPane.Pane>
                        </SplitPane>
                    )
                    : states}
            </div>
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
