import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon, IconButton, Tooltip } from 'baukasten-ui/core';
import { bezierPath, movedEdge, type GraphLayout, type LayoutNode, type Point, type Primitive } from '../visualizer/layout.js';
import { edgeColor, nodeColors, type NodeColors } from '../visualizer/tones.js';

// The graph, drawn from Graphviz's layout: nodes and edges as SVG in the
// editor's look, with panning, zooming, dragging nodes, highlighting an atom's
// relations on hover, and double-clicking an atom to evaluate it.

const MARGIN = 24;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

interface View {
    scale: number;
    x: number;
    y: number;
}

/** Where the graph starts: at 100%, or smaller when it doesn't fit (never below 60%), centred where it fits. */
function initialView(layout: GraphLayout, width: number, height: number): View {
    const fit = Math.min((width - 2 * MARGIN) / layout.width, (height - 2 * MARGIN) / layout.height);
    const scale = Math.min(1, Math.max(0.6, fit));
    const w = layout.width * scale;
    const h = layout.height * scale;
    return { scale, x: w < width ? (width - w) / 2 : MARGIN, y: h < height ? Math.max(MARGIN, (height - h) / 3) : MARGIN };
}

function fitView(layout: GraphLayout, width: number, height: number): View {
    const scale = Math.max(MIN_ZOOM, Math.min(2, (width - 2 * MARGIN) / layout.width, (height - 2 * MARGIN) / layout.height));
    return { scale, x: (width - layout.width * scale) / 2, y: (height - layout.height * scale) / 2 };
}

const pointsAttr = (points: readonly Point[]) => points.map(p => `${p[0]},${p[1]}`).join(' ');

function dash(dashed: boolean, dotted: boolean): string | undefined {
    return dashed ? '6 4' : dotted ? '1.5 3' : undefined;
}

function Shape({ node, colors }: { node: LayoutNode, colors: NodeColors }) {
    const common = { stroke: colors.stroke, strokeWidth: node.bold ? 2.5 : 1.2, strokeDasharray: dash(node.dashed, node.dotted) };
    const box = node.shape === 'box' && node.primitives.length === 1 && node.primitives[0].kind === 'polygon';
    if (box) {
        return <rect x={node.x - node.width / 2} y={node.y - node.height / 2} width={node.width} height={node.height} rx={5} fill={colors.fill} {...common} />;
    }
    return <>{node.primitives.map((p: Primitive, i) => {
        const fill = 'filled' in p && p.filled ? colors.fill : 'none';
        switch (p.kind) {
            case 'polygon': return <polygon key={i} points={pointsAttr(p.points)} fill={fill} {...common} />;
            case 'ellipse': return <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={fill} {...common} />;
            case 'polyline': return <polyline key={i} points={pointsAttr(p.points)} fill="none" {...common} />;
            case 'bezier': return <path key={i} d={bezierPath(p.points)} fill={fill} {...common} />;
        }
    })}</>;
}

export function GraphCanvas({ layout, onAtom }: { layout: GraphLayout, onAtom?: (atom: string) => void }) {
    const frame = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ width: number, height: number }>();
    const [view, setView] = useState<View>();
    const [moved, setMoved] = useState<Record<string, Point>>({});
    const [hovered, setHovered] = useState<string>();
    const drag = useRef<{ kind: 'pan' | 'node', id?: string, x: number, y: number } | undefined>(undefined);

    useLayoutEffect(() => {
        const element = frame.current;
        if (!element) return;
        // Measured now as well, so the first frame already has the graph rather than waiting for the observer.
        const box = element.getBoundingClientRect();
        setSize({ width: box.width, height: box.height });
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // A new layout starts afresh: its own view, nothing dragged.
    useEffect(() => {
        setMoved({});
        setView(size ? initialView(layout, size.width, size.height) : undefined);
    }, [layout]);
    useEffect(() => {
        if (size && !view) setView(initialView(layout, size.width, size.height));
    }, [size, view, layout]);

    const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
        setView(v => {
            if (!v) return v;
            const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * factor));
            const k = scale / v.scale;
            return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
        });
    }, []);

    // Pinch or Ctrl/Cmd+wheel zooms at the pointer; a plain wheel or trackpad pans.
    useEffect(() => {
        const element = frame.current;
        if (!element) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const box = element.getBoundingClientRect();
            if (event.ctrlKey || event.metaKey) {
                zoomAt(Math.exp(-event.deltaY * 0.0025), event.clientX - box.left, event.clientY - box.top);
            } else {
                setView(v => v && { ...v, x: v.x - event.deltaX, y: v.y - event.deltaY });
            }
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    }, [zoomAt]);

    const start = (event: ReactPointerEvent, kind: 'pan' | 'node', id?: string) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        drag.current = { kind, id, x: event.clientX, y: event.clientY };
    };
    const move = (event: ReactPointerEvent) => {
        const current = drag.current;
        if (!current || !view) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        drag.current = { ...current, x: event.clientX, y: event.clientY };
        if (current.kind === 'pan') {
            setView({ ...view, x: view.x + dx, y: view.y + dy });
        } else if (current.id) {
            const id = current.id;
            setMoved(m => ({ ...m, [id]: [(m[id]?.[0] ?? 0) + dx / view.scale, (m[id]?.[1] ?? 0) + dy / view.scale] }));
        }
    };
    const end = () => { drag.current = undefined; };

    const edges = useMemo(() => layout.edges.map(edge =>
        movedEdge(edge, moved[edge.tail] ?? [0, 0], moved[edge.head] ?? [0, 0])), [layout, moved]);
    const neighbours = useMemo(() => {
        if (!hovered) return undefined;
        const near = new Set([hovered]);
        for (const e of layout.edges) {
            if (e.tail === hovered) near.add(e.head);
            if (e.head === hovered) near.add(e.tail);
        }
        return near;
    }, [hovered, layout]);
    const faded = (on: boolean): CSSProperties => ({ opacity: on ? 1 : 0.18, transition: 'opacity var(--bk-transition-fast)' });

    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    return (
        <div ref={frame} className="alloy-canvas">
            {view && (
                <svg width="100%" height="100%" role="img" aria-label="Instance graph"
                    onPointerDown={e => start(e, 'pan')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                    <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
                        {edges.map(edge => {
                            const color = edgeColor(edge.tone) ?? edge.color;
                            return (
                                <g key={edge.id} style={faded(!hovered || edge.tail === hovered || edge.head === hovered)}>
                                    <path d={bezierPath(edge.points)} fill="none" stroke={color}
                                        strokeWidth={edge.bold ? 2.5 : 1.4} strokeDasharray={dash(edge.dashed, edge.dotted)} />
                                    {edge.arrows.map((arrow, i) => <polygon key={i} points={pointsAttr(arrow.points)} fill={color} stroke={color} strokeWidth={0.8} />)}
                                    {edge.label && (
                                        <text className="alloy-canvas-edge-label" x={edge.label.x} y={edge.label.y} textAnchor={edge.label.align}
                                            fontSize={edge.label.size} fill={color}>{edge.label.text}</text>
                                    )}
                                </g>
                            );
                        })}
                        {layout.nodes.map(node => {
                            const [dx, dy] = moved[node.id] ?? [0, 0];
                            // The theme's colour in the editor's tokens; a node without one keeps Graphviz's fill.
                            const colors = nodeColors(node.tone) ?? { fill: node.fill, stroke: 'var(--bk-color-foreground-muted)', ink: 'var(--bk-color-foreground)' };
                            return (
                                <g key={node.id} className="alloy-canvas-node" transform={`translate(${dx},${dy})`}
                                    style={faded(!neighbours || neighbours.has(node.id))}
                                    onPointerDown={e => start(e, 'node', node.id)}
                                    onPointerEnter={() => { if (!drag.current) setHovered(node.id); }}
                                    onPointerLeave={() => { if (!drag.current) setHovered(undefined); }}
                                    onDoubleClick={() => onAtom?.(node.id)}>
                                    <title>{`${node.id}${onAtom ? ' (double-click to evaluate)' : ''}`}</title>
                                    <Shape node={node} colors={colors} />
                                    {node.texts.map((t, i) => (
                                        <text key={i} x={t.x} y={t.y} textAnchor={t.align} fontSize={t.size} fill={colors.ink}
                                            fontWeight={i === 0 ? 600 : 400} opacity={i === 0 ? 1 : 0.85}>{t.text}</text>
                                    ))}
                                </g>
                            );
                        })}
                    </g>
                </svg>
            )}
            <div className="alloy-zoom" role="group" aria-label="Zoom">
                <Tooltip content="Zoom out" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="zoom-out" />} aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, width / 2, height / 2)} /></Tooltip>
                <Tooltip content="Fit to the window" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="screen-normal" />} aria-label="Fit to the window" onClick={() => size && setView(fitView(layout, size.width, size.height))} /></Tooltip>
                <Tooltip content="Actual size" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="screen-full" />} aria-label="Actual size" onClick={() => setView({ scale: 1, x: MARGIN, y: MARGIN })} /></Tooltip>
                <Tooltip content="Zoom in" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="zoom-in" />} aria-label="Zoom in" onClick={() => zoomAt(1.25, width / 2, height / 2)} /></Tooltip>
                <Tooltip content="Put the nodes back" placement="left"><IconButton size="sm" variant="ghost" icon={<Icon name="discard" />} aria-label="Put the nodes back" disabled={Object.keys(moved).length === 0} onClick={() => setMoved({})} /></Tooltip>
            </div>
        </div>
    );
}
