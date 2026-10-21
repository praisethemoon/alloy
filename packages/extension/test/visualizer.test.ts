import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { parseXml } from "../src/visualizer/xml.js";
import { allAtoms, isTemporal, parseInstance, successor } from "../src/visualizer/instance.js";
import { atomName, EDGE_COLORS, instanceToDot, NODE_COLOR } from "../src/visualizer/dot.js";
import { instanceToTables, instanceToText, instanceToTree } from "../src/visualizer/views.js";

// Fixtures are instances the session helper wrote:
// family: abstract sig Person { parent: lone Person }, one sig Alice, sig Bob { likes: Person -> Person }
// graph:  sig Node { var edges: set Node }, a two-state lasso trace
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
const family = parseInstance(fixture("family-instance.xml"));
const graph = parseInstance(fixture("graph-trace.xml"));

describe("instance XML", () => {
    test("elements, attributes and entities", () => {
        const root = parseXml(`<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y='&quot;q&quot;'><b/><c z="&#65;"></c></a>`);
        const a = root.children[0];
        expect([a.name, a.attributes.x, a.attributes.y]).toEqual(["a", "1 & 2", '"q"']);
        expect(a.children.map(c => [c.name, c.attributes.z])).toEqual([["b", undefined], ["c", "A"]]);
        expect(() => parseXml("<a><b></a>")).toThrow("Unexpected </a>");
        expect(() => parseXml("<a>")).toThrow("<a> is never closed.");
    });

    test("a static instance: sigs, subsigs, atoms, fields and their columns", () => {
        expect([family.command, family.traceLength, family.loopState, family.states.length]).toEqual(["Run show for 3", 1, 0, 1]);
        expect(isTemporal(family)).toBe(false);
        const state = family.states[0];
        const person = state.sigs.find(s => s.label === "this/Person")!;
        expect([person.abstract, person.atoms, allAtoms(state, person)]).toEqual([true, [], ["Alice$0", "Bob$0"]]);
        const likes = state.fields.find(f => f.label === "likes")!;
        expect([likes.types.length, likes.tuples.length, likes.tuples[0]]).toEqual([3, 4, ["Bob$0", "Alice$0", "Alice$0"]]);
    });

    test("a lasso trace: its states, its loop and var fields", () => {
        expect([graph.traceLength, graph.loopLength, graph.loopState, graph.states.length]).toEqual([2, 1, 1, 2]);
        expect(isTemporal(graph)).toBe(true);
        expect([successor(graph, 0), successor(graph, 1)]).toEqual([1, 1]);
        expect(graph.states.map(s => s.fields[0].tuples.length)).toEqual([1, 2]);
    });

    test("no instance is an error", () => {
        expect(() => parseInstance("<alloy></alloy>")).toThrow("The XML holds no Alloy instance.");
    });
});

describe("atom names", () => {
    test("numbered like the app, a lone atom by its sig's name, superscripts for tables", () => {
        const state = graph.states[0];
        expect([atomName(state, "Node$0"), atomName(state, "Node$1"), atomName(state, "Node$1", true)]).toEqual(["Node0", "Node1", "Node¹"]);
        expect([atomName(family.states[0], "Alice$0"), atomName(family.states[0], "7")]).toEqual(["Alice", "7"]);
    });
});

describe("dot in the app's default look", () => {
    test("atoms are gold boxes, relations arcs in the Classic colours, middle columns in brackets", () => {
        const dot = instanceToDot(family.states[0]);
        expect(dot).toContain(`node [shape=box, fillcolor="${NODE_COLOR}"`);
        expect(dot).toContain('"Alice$0" [label="Alice", style="filled"];');
        expect(dot).toContain(`"Bob$0" -> "Alice$0" [label="likes[Alice]", color="${EDGE_COLORS[0]}", fontcolor="${EDGE_COLORS[0]}", style=solid];`);
        expect(dot).toContain(`"Alice$0" -> "Bob$0" [label="parent", color="${EDGE_COLORS[1]}"`);
    });

    test("var relations are dashed and opposing arcs of one relation merge", () => {
        const second = graph.states[1];
        const dot = instanceToDot(second);
        expect(dot).toContain('"Node$0" -> "Node$1" [label="edges"');
        expect(dot).toContain("style=dashed");
        const merged = instanceToDot({ ...second, fields: [{ ...second.fields[0], tuples: [["Node$0", "Node$1"], ["Node$1", "Node$0"]] }] });
        expect(merged.match(/->/g)).toHaveLength(1);
        expect(merged).toContain("dir=both");
    });

    test("sets and one-column skolems label their atoms; builtin atoms show only when connected", () => {
        const state = graph.states[0];
        const withSets = instanceToDot({
            ...state,
            sigs: [...state.sigs,
                { id: "90", label: "this/Hub", subsetOf: ["4"], builtin: false, abstract: false, var: false, private: false, meta: false, atoms: ["Node$1"] },
                { id: "91", label: "Int", subsetOf: [], builtin: true, abstract: false, var: false, private: false, meta: false, atoms: ["7"] }],
            skolems: [{ id: "92", label: "$show_n", skolem: true, var: false, private: false, meta: false, tuples: [["Node$0"]], types: ["4"] }]
        });
        expect(withSets).toContain('"Node$1" [label="Node1\\n(Hub)"');
        expect(withSets).toContain('"Node$0" [label="Node0\\n$show_n"');
        expect(withSets).not.toContain('"7"');
    });

    test("Graphviz lays it out as SVG", async () => {
        const graphviz = await Graphviz.load();
        const svg = graphviz.dot(instanceToDot(family.states[0]));
        expect(svg).toContain("<svg");
        expect(svg).toContain(">Alice</text>");
        expect(svg).toContain(">likes[Alice]</text>");
    });
});

describe("text, table and tree views", () => {
    test("Txt lists univ, sigs with their subsigs' atoms, fields and skolems as the Analyzer does", () => {
        const text = instanceToText(family.states[0]);
        expect(text.split("\n")).toEqual(expect.arrayContaining([
            "this/Person={Alice$0, Bob$0}",
            "this/Alice={Alice$0}",
            "this/Person<:parent={Alice$0->Bob$0, Bob$0->Bob$0}"
        ]));
        expect(text.startsWith("univ={")).toBe(true);
    });

    test("Table has a table per sig with its fields' values", () => {
        const person = instanceToTables(family.states[0]).find(t => t.title === "Person")!;
        expect(person.columns).toEqual(["Person", "parent"]);
        expect(person.rows).toEqual([["Alice", "Bob"], ["Bob", "Bob"]]);
        const node = instanceToTables(graph.states[1]).find(t => t.title === "Node")!;
        expect(node.rows).toEqual([["Node⁰", "Node⁰, Node¹"], ["Node¹", ""]]);
    });

    test("Tree nests sigs, atoms, fields and values", () => {
        const tree = instanceToTree(graph.states[1]);
        const node0 = tree.find(n => n.label === "Node")!.children![0];
        expect(node0.label).toBe("Node0");
        expect(node0.children![0]).toMatchObject({ label: "edges", children: [{ label: "Node0" }, { label: "Node1" }] });
    });
});
