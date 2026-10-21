import { useEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton, Input } from 'baukasten-ui/core';

/** One evaluation: what was typed, in which state, and what came back. */
export interface Evaluation {
    id: number;
    expr: string;
    state: number;
    value?: string;
    error?: string;
}

/**
 * The app's Evaluator: type an Alloy expression or formula and see its value
 * in the focused state; UP and DOWN recall earlier inputs.
 */
export function Evaluator({ evaluations, temporal, focus, disabled, onEvaluate, onClear, onClose }: {
    evaluations: Evaluation[];
    temporal: boolean;
    focus: number;
    disabled?: string;
    onEvaluate: (expr: string) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const [text, setText] = useState('');
    const [recall, setRecall] = useState<number>();
    const log = useRef<HTMLDivElement>(null);
    useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [evaluations]);
    const inputs = evaluations.map(e => e.expr);

    const submit = () => {
        const expr = text.trim();
        if (!expr) return;
        onEvaluate(expr);
        setText('');
        setRecall(undefined);
    };
    const step = (delta: number) => {
        if (inputs.length === 0) return;
        const at = recall === undefined ? (delta < 0 ? inputs.length - 1 : undefined) : recall + delta;
        if (at === undefined || at < 0) return;
        if (at >= inputs.length) { setRecall(undefined); setText(''); return; }
        setRecall(at);
        setText(inputs[at]);
    };

    return (
        <section className="alloy-evaluator" aria-label="Evaluator">
            <header className="alloy-evaluator-header">
                <strong>Evaluator</strong>
                <span className="alloy-muted">{temporal ? `in state ${focus}; x' is state ${focus}'s successor` : 'in this instance'}</span>
                <span style={{ flex: 1 }} />
                <Button variant="ghost" size="sm" onClick={onClear} disabled={evaluations.length === 0}>Clear</Button>
                <IconButton variant="ghost" size="sm" icon={<Icon name="close" />} aria-label="Close the evaluator" onClick={onClose} />
            </header>
            <div ref={log} className="alloy-evaluator-log">
                {evaluations.length === 0 && <p className="alloy-muted">Type an expression such as <code>univ</code> or a formula, then Enter.</p>}
                {evaluations.map(e => (
                    <div key={e.id} className="alloy-evaluation">
                        <div className="alloy-evaluation-expr">{temporal && <span className="alloy-muted">[{e.state}] </span>}{e.expr}</div>
                        {e.value === undefined && e.error === undefined
                            ? <div className="alloy-muted">…</div>
                            : e.error !== undefined
                                ? <div className="alloy-evaluation-error">{e.error}</div>
                                : <div className="alloy-evaluation-value">{e.value}</div>}
                    </div>
                ))}
            </div>
            <Input
                fullWidth
                size="sm"
                value={text}
                disabled={!!disabled}
                placeholder={disabled ?? 'Expression or formula'}
                aria-label="Expression to evaluate"
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') submit();
                    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
                    else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
                }}
            />
        </section>
    );
}
