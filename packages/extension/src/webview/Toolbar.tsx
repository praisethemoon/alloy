import type { ReactElement } from 'react';
import { Button, Divider, Icon, IconButton, Tooltip } from 'baukasten-ui/core';
import { ButtonGroup } from 'baukasten-ui/extra';
import type { Move } from '../visualizer/protocol.js';
import type { ViewKind } from './StateView.js';

// Labels and tooltips are the Alloy app's own (VizGUI).
const VIEWS: Array<{ kind: ViewKind, label: string, tip: string }> = [
    { kind: 'viz', label: 'Viz', tip: 'Show Visualization' },
    { kind: 'txt', label: 'Txt', tip: 'Show the textual output for the Graph' },
    { kind: 'table', label: 'Table', tip: 'Show the table output for the Graph' },
    { kind: 'tree', label: 'Tree', tip: 'Show Tree' }
];

const TRACE_MOVES: Array<{ move: Move, label: string, tip: string }> = [
    { move: 'config', label: 'New Config', tip: 'Show a new configuration' },
    { move: 'trace', label: 'New Trace', tip: 'Show a new trace' },
    { move: 'init', label: 'New Init', tip: 'Show a new initial state' },
    { move: 'fork', label: 'New Fork', tip: 'Show a new fork' }
];

function tip(text: string, child: ReactElement) {
    return <Tooltip content={text} placement="bottom" delay={400}>{child}</Tooltip>;
}

export interface ToolbarProps {
    view: ViewKind;
    onView: (view: ViewKind) => void;
    temporal: boolean;
    /** Why solutions can't be enumerated, if they can't. */
    noEnumeration?: string;
    newTraceAllowed: boolean;
    busy: boolean;
    onMove: (move: Move) => void;
    canPrevious: boolean;
    onPrevious: () => void;
    onNext: () => void;
    evaluatorOpen: boolean;
    onToggleEvaluator: () => void;
}

export function Toolbar(props: ToolbarProps) {
    const { view, onView, temporal, noEnumeration, newTraceAllowed, busy, onMove } = props;
    const moveDisabled = busy || !!noEnumeration;
    return (
        <div className="alloy-toolbar" role="toolbar" aria-label="Visualizer">
            <ButtonGroup>
                {VIEWS.map(v => tip(v.tip,
                    <Button key={v.kind} size="sm" variant={view === v.kind ? 'primary' : 'secondary'} aria-pressed={view === v.kind} onClick={() => onView(v.kind)}>
                        {v.label}
                    </Button>))}
            </ButtonGroup>
            <Divider orientation="vertical" spacing="var(--bk-spacing-1)" />
            {tip(props.evaluatorOpen ? 'Close the evaluator' : 'Open the evaluator',
                <Button size="sm" variant={props.evaluatorOpen ? 'primary' : 'secondary'} aria-pressed={props.evaluatorOpen} onClick={props.onToggleEvaluator}>
                    <Icon name="terminal" /> Evaluator
                </Button>)}
            <Divider orientation="vertical" spacing="var(--bk-spacing-1)" />
            {temporal
                ? TRACE_MOVES.map(m => {
                    const blocked = noEnumeration ?? (m.move === 'trace' && !newTraceAllowed ? 'A new trace can\'t follow New Init or New Fork; use New Config first.' : undefined);
                    return tip(blocked ?? m.tip,
                        <span key={m.move}>
                            <Button size="sm" variant="secondary" disabled={moveDisabled || !!blocked} onClick={() => onMove(m.move)}>{m.label}</Button>
                        </span>);
                })
                : tip(noEnumeration ?? 'Show a new solution',
                    <span>
                        <Button size="sm" variant="secondary" disabled={moveDisabled} onClick={() => onMove('next')}>
                            <Icon name="debug-step-over" /> New
                        </Button>
                    </span>)}
            {temporal && <>
                <Divider orientation="vertical" spacing="var(--bk-spacing-1)" />
                {tip('Show the previous state',
                    <span><IconButton size="sm" variant="ghost" icon={<Icon name="arrow-left" />} aria-label="Show the previous state" disabled={!props.canPrevious} onClick={props.onPrevious} /></span>)}
                {tip('Show the next state',
                    <span><IconButton size="sm" variant="ghost" icon={<Icon name="arrow-right" />} aria-label="Show the next state" onClick={props.onNext} /></span>)}
            </>}
        </div>
    );
}
