import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Alert, Code, Icon, Spinner, Table } from 'baukasten-ui/core';
import { instanceToDot } from '../visualizer/dot.js';
import type { AlloyState } from '../visualizer/instance.js';
import { parseLayout, type GraphLayout } from '../visualizer/layout.js';
import { projectState } from '../visualizer/projection.js';
import type { Theme } from '../visualizer/theme.js';
import { instanceToTables, instanceToText, instanceToTree, type InstanceTreeNode } from '../visualizer/views.js';
import { GraphCanvas } from './GraphCanvas.js';
import { loadGraphviz } from './host.js';

/** The app's four ways to show an instance. */
export type ViewKind = 'viz' | 'txt' | 'table' | 'tree';

const scroll: CSSProperties = { height: '100%', overflow: 'auto', padding: 'var(--bk-padding-md)', boxSizing: 'border-box' };

/** One state of the instance in the chosen view; the graph follows the theme and projection. */
export function StateView({ state, view, theme, picks, onAtom }: {
    state: AlloyState, view: ViewKind, theme: Theme, picks: Record<string, string>, onAtom?: (atom: string) => void
}) {
    switch (view) {
        case 'viz': return <GraphView state={state} theme={theme} picks={picks} onAtom={onAtom} />;
        case 'txt': return <div style={scroll}><Code block>{instanceToText(state)}</Code></div>;
        case 'table': return <TablesView state={state} />;
        case 'tree': return <div style={scroll}><InstanceTree nodes={instanceToTree(state)} /></div>;
    }
}

/** The graph: Graphviz lays out the dot the theme and projection give, and GraphCanvas draws it. */
function GraphView({ state, theme, picks, onAtom }: { state: AlloyState, theme: Theme, picks: Record<string, string>, onAtom?: (atom: string) => void }) {
    const dot = useMemo(() => instanceToDot(projectState(state, picks), theme), [state, theme, picks]);
    const [layout, setLayout] = useState<GraphLayout>();
    const [error, setError] = useState<string>();
    useEffect(() => {
        let current = true;
        setError(undefined);
        loadGraphviz()
            .then(graphviz => { if (current) setLayout(parseLayout(graphviz.layout(dot, 'json', 'dot'))); })
            .catch((e: Error) => { if (current) setError(e.message); });
        return () => { current = false; };
    }, [dot]);
    if (error) return <div style={scroll}><Alert variant="error" title="Graphviz could not lay out this instance">{error}</Alert></div>;
    if (!layout) return <div style={{ ...scroll, display: 'grid', placeItems: 'center' }}><Spinner aria-label="Laying out the graph" /></div>;
    return <GraphCanvas layout={layout} onAtom={onAtom} />;
}

function TablesView({ state }: { state: AlloyState }) {
    const tables = instanceToTables(state);
    return (
        <div style={{ ...scroll, display: 'flex', flexDirection: 'column', gap: 'var(--bk-gap-lg)' }}>
            {tables.map(table => (
                <Table key={table.title} size="sm" variant="zebra" fullWidth={false}>
                    <Table.Head>
                        <Table.Row>
                            {table.columns.map((column, i) => <Table.HeaderCell key={i}>{column}</Table.HeaderCell>)}
                        </Table.Row>
                    </Table.Head>
                    <Table.Body empty={table.rows.length === 0} emptyText="No atoms" colSpan={table.columns.length}>
                        {table.rows.map((row, r) => (
                            <Table.Row key={r}>
                                {row.map((cell, c) => <Table.Cell key={c}>{cell}</Table.Cell>)}
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            ))}
        </div>
    );
}

// baukasten-ui 0.3.0 on npm has no Tree, so this is a small one in its tokens.
function InstanceTree({ nodes }: { nodes: InstanceTreeNode[] }) {
    const [open, setOpen] = useState<Set<string>>(() => new Set(nodes.map(n => n.id)));
    const toggle = (id: string) => setOpen(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const render = (node: InstanceTreeNode, depth: number) => {
        const children = node.children ?? [];
        const expanded = open.has(node.id);
        return (
            <li key={node.id} role="treeitem" aria-expanded={children.length > 0 ? expanded : undefined}>
                <button
                    type="button"
                    className="alloy-tree-row"
                    style={{ paddingLeft: `calc(${depth} * var(--bk-spacing-4) + var(--bk-spacing-1))` }}
                    onClick={() => children.length > 0 && toggle(node.id)}
                >
                    <span style={{ width: 'var(--bk-spacing-4)', display: 'inline-flex' }}>
                        {children.length > 0 && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />}
                    </span>
                    {node.label}
                </button>
                {children.length > 0 && expanded && <ul role="group">{children.map(c => render(c, depth + 1))}</ul>}
            </li>
        );
    };
    return <ul className="alloy-tree" role="tree">{nodes.map(n => render(n, 0))}</ul>;
}
