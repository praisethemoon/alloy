import { beforeAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { parseInstance } from "../src/visualizer/instance.js";
import { instanceToDot } from "../src/visualizer/dot.js";
import { bezierPath, movedEdge, parseLayout, prefersDarkText, type GraphLayout } from "../src/visualizer/layout.js";
import { parseTheme } from "../src/visualizer/theme.js";
import { projectionAtoms, projectState } from "../src/visualizer/projection.js";

// Graphviz's layout of real instances, as the graph view reads it.

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
let graphviz: Graphviz;
beforeAll(async () => { graphviz = await Graphviz.load(); });
const layoutOf = (dot: string): GraphLayout => parseLayout(graphviz.layout(dot, "json", "dot"));

describe("Graphviz's layout as data", () => {
    test("nodes: placed inside the graph, with their shape, fill and label lines", () => {
        const layout = layoutOf(instanceToDot(parseInstance(fixture("family-instance.xml")).states[0]));
        expect(layout.nodes.map(n => n.id).sort()).toEqual(["Alice$0", "Bob$0"]);
        for (const node of layout.nodes) {
            expect(node.x).toBeGreaterThan(0);
            expect(node.x).toBeLessThan(layout.width);
            expect(node.y).toBeGreaterThan(0);
            expect(node.y).toBeLessThan(layout.height);
            expect([node.shape, node.fill, node.primitives[0].kind]).toEqual(["box", "#ffd700", "polygon"]);
        }
        expect(layout.nodes.find(n => n.id === "Alice$0")!.texts.map(t => t.text)).toEqual(["Alice"]);
    });

    test("edges: their ends, spline, arrowhead, colour and label", () => {
        const layout = layoutOf(instanceToDot(parseInstance(fixture("family-instance.xml")).states[0]));
        const likes = layout.edges.find(e => e.label?.text === "likes[Alice]" && e.tail !== e.head)!;
        expect([likes.tail, likes.head, likes.color]).toEqual(["Bob$0", "Alice$0", "#e41a1c"]);
        expect((likes.points.length - 1) % 3).toBe(0);
        expect(likes.arrows.map(a => a.end)).toEqual(["head"]);
        expect(likes.label!.color).toBe("#e41a1c");
        expect(bezierPath(likes.points)).toMatch(/^M[\d.]+,[\d.]+( C[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+)+$/);
    });

    test("var arcs are dashed and merged opposing arcs have heads at both ends", () => {
        const state = parseInstance(fixture("graph-trace.xml")).states[1];
        expect(layoutOf(instanceToDot(state)).edges.every(e => e.dashed)).toBe(true);
        const merged = layoutOf(instanceToDot({ ...state, fields: [{ ...state.fields[0], tuples: [["Node$0", "Node$1"], ["Node$1", "Node$0"]] }] }));
        expect(merged.edges).toHaveLength(1);
        expect(merged.edges[0].arrows.map(a => a.end).sort()).toEqual(["head", "tail"]);
    });

    test("a theme's shapes and projection come through", () => {
        const theme = parseTheme(fixture("hotel.thm"));
        const state = parseInstance(fixture("hotel-counterexample.xml")).states[0];
        const layout = layoutOf(instanceToDot(projectState(state, { Time: projectionAtoms(state, "Time")[0] }), theme));
        expect(layout.nodes.some(n => n.id.startsWith("Time$"))).toBe(false);
        expect(layout.nodes.find(n => n.id === "Room$0")!.texts.map(t => t.text)).toEqual(expect.arrayContaining(["Room", expect.stringMatching(/^key: K\d$/)]));
        const genealogy = layoutOf(instanceToDot(parseInstance(fixture("genealogy-instance.xml")).states[0], parseTheme(fixture("genealogy.thm"))));
        expect(genealogy.nodes.every(n => n.shape === "ellipse" && n.primitives[0].kind === "ellipse")).toBe(true);
    });
});

describe("dragging and contrast", () => {
    test("a dragged edge keeps its shape: its tail end moves with the tail, its head end and arrow with the head", () => {
        const layout = layoutOf(instanceToDot(parseInstance(fixture("family-instance.xml")).states[0]));
        const edge = layout.edges.find(e => e.tail !== e.head)!;
        expect(movedEdge(edge, [0, 0], [0, 0])).toBe(edge);
        const moved = movedEdge(edge, [10, 0], [0, 20]);
        expect(moved.points[0]).toEqual([edge.points[0][0] + 10, edge.points[0][1]]);
        expect(moved.points.at(-1)).toEqual([edge.points.at(-1)![0], edge.points.at(-1)![1] + 20]);
        expect(moved.arrows[0].points[0]).toEqual([edge.arrows[0].points[0][0], edge.arrows[0].points[0][1] + 20]);
        expect(moved.label!.x).toBeCloseTo(edge.label!.x + 5);
    });

    test("text is dark on light fills and light on dark ones", () => {
        expect([prefersDarkText("#ffd700"), prefersDarkText("#ffffff"), prefersDarkText("#6495ed")]).toEqual([true, true, true]);
        expect([prefersDarkText("#0000ff"), prefersDarkText("#000000"), prefersDarkText("#984ea3")]).toEqual([false, false, false]);
    });
});
