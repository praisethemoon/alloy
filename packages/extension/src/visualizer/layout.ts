// Graphviz's layout of an instance, as its JSON output gives it (-Tjson):
// node shapes, label lines, edge splines and arrowheads, all placed. The
// visualizer draws these itself; Graphviz only lays them out. Coordinates
// are turned from Graphviz's (points, y up) into SVG's (y down).

export type Point = readonly [number, number];

/** One line of text, centred on its point unless aligned otherwise. */
export interface LayoutText {
    x: number;
    y: number;
    text: string;
    size: number;
    color: string;
    width: number;
    align: 'start' | 'middle' | 'end';
}

/** A piece of a shape: what Graphviz's drawing operations make. */
export type Primitive =
    | { kind: 'polygon', points: Point[], filled: boolean }
    | { kind: 'ellipse', cx: number, cy: number, rx: number, ry: number, filled: boolean }
    | { kind: 'polyline', points: Point[] }
    | { kind: 'bezier', points: Point[], filled: boolean };

export interface LayoutNode {
    /** The node's name in the dot: the atom. */
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Graphviz's shape name, e.g. box or ellipse. */
    shape: string;
    primitives: Primitive[];
    fill: string;
    stroke: string;
    dashed: boolean;
    dotted: boolean;
    bold: boolean;
    texts: LayoutText[];
    /** The theme colour the dot names (tone-yellow, …), for drawing in the editor's colours. */
    tone?: string;
}

export interface LayoutEdge {
    id: string;
    tail: string;
    head: string;
    /** The spline's Bézier points: start, then three per segment. */
    points: Point[];
    /** Arrowhead polygons, at the head and, for two-headed arcs, the tail. */
    arrows: Array<{ end: 'head' | 'tail', points: Point[] }>;
    color: string;
    dashed: boolean;
    dotted: boolean;
    bold: boolean;
    label?: LayoutText;
    /** The theme colour the dot names (tone-red, tone-magic-2, …). */
    tone?: string;
}

export interface GraphLayout {
    width: number;
    height: number;
    nodes: LayoutNode[];
    edges: LayoutEdge[];
}

interface DrawOp {
    op: string;
    points?: number[][];
    rect?: number[];
    color?: string;
    style?: string;
    pt?: number[];
    text?: string;
    size?: number;
    width?: number;
    align?: string;
}

interface GvObject {
    _gvid: number;
    name: string;
    pos?: string;
    width?: string;
    height?: string;
    shape?: string;
    class?: string;
    _draw_?: DrawOp[];
    _ldraw_?: DrawOp[];
}

interface GvEdge {
    _gvid: number;
    tail: number;
    head: number;
    class?: string;
    _draw_?: DrawOp[];
    _hdraw_?: DrawOp[];
    _tdraw_?: DrawOp[];
    _ldraw_?: DrawOp[];
}

interface GvGraph {
    bb: string;
    objects?: GvObject[];
    edges?: GvEdge[];
}

const INCH = 72;

/** What a list of drawing operations draws, and the pen and fill it ends with. */
function interpret(ops: DrawOp[] | undefined, flip: (p: number[]) => Point) {
    const primitives: Primitive[] = [];
    const texts: LayoutText[] = [];
    let pen = '#000000';
    let fill = 'none';
    let size = 14;
    const styles = new Set<string>();
    for (const op of ops ?? []) {
        switch (op.op) {
            case 'c': pen = op.color ?? pen; break;
            case 'C': fill = op.color ?? fill; break;
            case 'S': if (op.style) styles.add(op.style.replace(/\(.*$/, '')); break;
            case 'F': size = op.size ?? size; break;
            case 'P': case 'p':
                primitives.push({ kind: 'polygon', points: (op.points ?? []).map(flip), filled: op.op === 'P' });
                break;
            case 'E': case 'e': {
                const [cx, cy, rx, ry] = op.rect ?? [0, 0, 0, 0];
                const [x, y] = flip([cx, cy]);
                primitives.push({ kind: 'ellipse', cx: x, cy: y, rx, ry, filled: op.op === 'E' });
                break;
            }
            case 'L':
                primitives.push({ kind: 'polyline', points: (op.points ?? []).map(flip) });
                break;
            case 'B': case 'b':
                primitives.push({ kind: 'bezier', points: (op.points ?? []).map(flip), filled: op.op === 'B' });
                break;
            case 'T': {
                const [x, y] = flip(op.pt ?? [0, 0]);
                texts.push({
                    x, y, text: op.text ?? '', size, color: pen, width: op.width ?? 0,
                    align: op.align === 'l' ? 'start' : op.align === 'r' ? 'end' : 'middle'
                });
                break;
            }
        }
    }
    return { primitives, texts, pen, fill, styles };
}

/** Reads Graphviz's -Tjson output. */
export function parseLayout(json: string): GraphLayout {
    const graph = JSON.parse(json) as GvGraph;
    const [x0, y0, x1, y1] = graph.bb.split(',').map(Number);
    const flip = (p: number[]): Point => [p[0] - x0, y1 - p[1]];
    const names = new Map<number, string>();
    const nodes: LayoutNode[] = [];
    for (const object of graph.objects ?? []) {
        names.set(object._gvid, object.name);
        if (!object.pos) continue;
        const [x, y] = flip(object.pos.split(',').map(Number));
        const shape = interpret(object._draw_, flip);
        const label = interpret(object._ldraw_, flip);
        nodes.push({
            id: object.name, x, y,
            width: Number(object.width ?? 0) * INCH,
            height: Number(object.height ?? 0) * INCH,
            shape: object.shape ?? 'box',
            primitives: shape.primitives,
            fill: shape.fill,
            stroke: shape.pen,
            dashed: shape.styles.has('dashed'),
            dotted: shape.styles.has('dotted'),
            bold: shape.styles.has('bold'),
            texts: label.texts,
            tone: object.class
        });
    }
    const edges: LayoutEdge[] = (graph.edges ?? []).map(edge => {
        const line = interpret(edge._draw_, flip);
        const spline = line.primitives.find(p => p.kind === 'bezier');
        const arrow = (ops: DrawOp[] | undefined) => interpret(ops, flip).primitives.find(p => p.kind === 'polygon') as { points: Point[] } | undefined;
        const head = arrow(edge._hdraw_);
        const tail = arrow(edge._tdraw_);
        return {
            id: `e${edge._gvid}`,
            tail: names.get(edge.tail) ?? '',
            head: names.get(edge.head) ?? '',
            points: spline && spline.kind === 'bezier' ? spline.points : [],
            arrows: [...head ? [{ end: 'head' as const, points: head.points }] : [], ...tail ? [{ end: 'tail' as const, points: tail.points }] : []],
            color: line.pen,
            dashed: line.styles.has('dashed'),
            dotted: line.styles.has('dotted'),
            bold: line.styles.has('bold'),
            label: interpret(edge._ldraw_, flip).texts[0],
            tone: edge.class
        };
    });
    return { width: x1 - x0, height: y1 - y0, nodes, edges };
}

/** An SVG path through Bézier points: start, then three per segment. */
export function bezierPath(points: readonly Point[]): string {
    if (points.length === 0) return '';
    const [start, ...rest] = points;
    let d = `M${start[0]},${start[1]}`;
    for (let i = 0; i + 2 < rest.length; i += 3) {
        d += ` C${rest[i][0]},${rest[i][1]} ${rest[i + 1][0]},${rest[i + 1][1]} ${rest[i + 2][0]},${rest[i + 2][1]}`;
    }
    return d;
}

/**
 * An edge after its ends' nodes were dragged: each spline point moves by a
 * blend of the two drags, more of the tail's near the tail and of the head's
 * near the head, so the curve keeps its shape; arrows move with their end.
 */
export function movedEdge(edge: LayoutEdge, tail: Point, head: Point): LayoutEdge {
    if (tail[0] === 0 && tail[1] === 0 && head[0] === 0 && head[1] === 0) return edge;
    const n = edge.points.length;
    const at = (t: number): Point => [tail[0] * (1 - t) + head[0] * t, tail[1] * (1 - t) + head[1] * t];
    const shift = (p: Point, d: Point): Point => [p[0] + d[0], p[1] + d[1]];
    return {
        ...edge,
        points: edge.points.map((p, i) => shift(p, at(n > 1 ? i / (n - 1) : 0))),
        arrows: edge.arrows.map(a => ({ ...a, points: a.points.map(p => shift(p, a.end === 'head' ? head : tail)) })),
        label: edge.label && (() => {
            const [x, y] = shift([edge.label.x, edge.label.y], at(0.5));
            return { ...edge.label, x, y };
        })()
    };
}
