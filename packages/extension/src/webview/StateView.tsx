import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Alert, Code, Icon, IconButton, Spinner, Table, Tooltip } from 'baukasten-ui/core';
import { instanceToDot } from '../visualizer/dot.js';
import type { AlloyState } from '../visualizer/instance.js';
import { projectState } from '../visualizer/projection.js';
import type { Theme } from '../visualizer/theme.js';
import { instanceToTables, instanceToText, instanceToTree, type InstanceTreeNode } from '../visualizer/views.js';
import { loadGraphviz } from './host.js';

/** The app's four ways to show an instance. */
export type ViewKind = 'viz' | 'txt' | 'table' | 'tree';

const scroll: CSSProperties = { height: '100%', overflow: 'auto', padding: 'var(--bk-padding-md)', boxSizing: 'border-box' };

/** One state of the instance in the chosen view; the graph follows the theme and projection. */
export function StateView({ state, view, theme, picks }: { state: AlloyState, view: ViewKind, theme: Theme, picks: Record<string, string> }) {
    switch (view) {
        case 'viz': return <GraphView state={state} theme={theme} picks={picks} />;
        case 'txt': return <div style={scroll}><Code block>{instanceToText(state)}</Code></div>;
        case 'table': return <TablesView state={state} />;
        case 'tree': return <div style={scroll}><InstanceTree nodes={instanceToTree(state)} /></div>;
    }
}

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];

/** The graph, laid out by Graphviz from the dot the theme and projection give, with zoom. */
function GraphView({ state, theme, picks }: { state: AlloyState, theme: Theme, picks: Record<string, string> }) {
    const dot = useMemo(() => instanceToDot(projectState(state, picks), theme), [state, theme, picks]);
    const [svg, setSvg] = useState<string>();
    const [zoom, setZoom] = useState<number>();
    const [error, setError] = useState<string>();
    useEffect(() => {
        let current = true;
        setError(undefined);
        loadGraphviz()
            .then(graphviz => { if (current) setSvg(graphviz.dot(dot)); })
            .catch((e: Error) => { if (current) setError(e.message); });
        return () => { current = false; };
    }, [dot]);
    if (error) return <div style={scroll}><Alert variant="error" title="Graphviz could not lay out this instance">{error}</Alert></div>;
    if (!svg) return <div style={{ ...scroll, display: 'grid', placeItems: 'center' }}><Spinner aria-label="Laying out the graph" /></div>;
    const step = (direction: number) => {
        const current = zoom ?? 1;
        const index = ZOOMS.findIndex(z => z >= current - 1e-9);
        setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (index < 0 ? ZOOMS.length - 1 : index) + direction))]);
    };
    return (
        <div className="alloy-graph-frame">
            <div className="alloy-zoom" role="group" aria-label="Zoom">
                <Tooltip content="Zoom out" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="zoom-out" />} aria-label="Zoom out" onClick={() => step(-1)} /></Tooltip>
                <Tooltip content="Fit to the window" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="screen-normal" />} aria-label="Fit to the window" onClick={() => setZoom(undefined)} /></Tooltip>
                <Tooltip content="Zoom in" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="zoom-in" />} aria-label="Zoom in" onClick={() => step(1)} /></Tooltip>
            </div>
            {/* Graphviz writes the SVG from the dot we generated, with every label escaped. */}
            <div className={zoom === undefined ? 'alloy-graph alloy-graph-fit' : 'alloy-graph'} style={{ ...scroll, zoom: zoom ?? 1 }} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
    );
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
