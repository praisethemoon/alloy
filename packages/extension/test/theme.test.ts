import { afterAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { AlloySession } from "alloy-lsp-language";
import { parseInstance } from "../src/visualizer/instance.js";
import { instanceToDot } from "../src/visualizer/dot.js";
import { emptyTheme, parseTheme, relationKey, setKey, writeTheme, type Theme } from "../src/visualizer/theme.js";
import { projectableSigs, projectionAtoms, projectState } from "../src/visualizer/projection.js";
import { magicLayout } from "../src/visualizer/magic.js";
import { instanceAsPredicate } from "../src/visualizer/export.js";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
const hotel = parseInstance(fixture("hotel-counterexample.xml"));
const genealogy = parseInstance(fixture("genealogy-instance.xml"));
const family = parseInstance(fixture("family-instance.xml"));

const jar = path.join(__dirname, "../alloy/alloy.jar");
const sessionJar = path.join(__dirname, "../alloy/alloy-session.jar");
const haveJava = fs.existsSync(jar) && (() => { try { execFileSync("javac", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-theme-"));

/** The theme with the projection's first atoms picked, rendered. */
function render(instanceState = hotel.states[0], theme: Theme) {
    const picks = Object.fromEntries(theme.projection.map(t => [t, projectionAtoms(instanceState, t)[0]]));
    return instanceToDot(projectState(instanceState, picks), theme);
}

describe(".thm files", () => {
    test("the app's hotel theme: projection, nodes, sets of relations as attributes", () => {
        const theme = parseTheme(fixture("hotel.thm"));
        expect(theme.projection).toEqual(["Time"]);
        expect(theme.types.Card).toEqual({ hideUnconnected: true, shape: "Ellipse" });
        expect(theme.types.Key).toEqual({ visible: false, label: "K" });
        expect(theme.types["timeOrder/Ord"]).toEqual({ visible: false });
        expect(theme.relations[relationKey("prev", ["Desk", "Room", "Key"])]).toEqual({ visible: false, attribute: true });
    });

    test("the app's genealogy theme: colours, a set's label, an edge weight", () => {
        const theme = parseTheme(fixture("genealogy.thm"));
        expect([theme.types.Man.color, theme.types.Woman.color, theme.types.Person.shape]).toEqual(["Blue", "Red", "Ellipse"]);
        expect(theme.sets[setKey("$Show_p", "Person")]).toEqual({ label: "p" });
        expect(theme.relations[relationKey("spouse", ["Person", "Person"])]).toEqual({ weight: 10 });
    });

    test("writing and reading back gives the same theme", () => {
        for (const name of ["hotel.thm", "genealogy.thm"]) {
            const theme = parseTheme(fixture(name));
            expect(parseTheme(writeTheme(theme))).toEqual(theme);
        }
        const custom: Theme = { ...emptyTheme(), nodePalette: "Martha", edgePalette: "Tol", fontSize: 14, useOriginalAtomNames: true, hidePrivate: false,
            defaultNode: { shape: "Hexagon" }, defaultEdge: { style: "Dotted", merge: false },
            types: { "A": { color: "Green", numberAtoms: false, style: "Bold" } },
            relations: { [relationKey("r", ["A", "A"])]: { layoutBack: true, constraint: false, color: "Black" } } };
        expect(parseTheme(writeTheme(custom))).toEqual(custom);
    });

    test("not a theme is an error", () => {
        expect(() => parseTheme("<alloy></alloy>")).toThrow("This is not an Alloy theme: it has no <view>.");
    });

    test.skipIf(!haveJava)("a theme written here is read by the app's own reader with every setting", { timeout: 120_000 }, () => {
        const classes = fs.mkdtempSync(path.join(scratch, "classes-"));
        execFileSync("javac", ["-cp", jar, "-d", classes, path.join(__dirname, "java", "ThemeCheck.java")]);
        const theme: Theme = { ...parseTheme(fixture("genealogy.thm")), nodePalette: "Neon", fontSize: 16,
            relations: { [relationKey("spouse", ["Person", "Person"])]: { weight: 10, style: "Dashed", layoutBack: true, attribute: true } } };
        const ours = path.join(scratch, "ours.thm");
        const theirs = path.join(scratch, "theirs.thm");
        const instance = path.join(scratch, "genealogy.xml");
        fs.writeFileSync(ours, writeTheme(theme));
        fs.writeFileSync(instance, fixture("genealogy-instance.xml"));
        execFileSync("java", ["-Djava.awt.headless=true", "-cp", [jar, classes].join(path.delimiter), "ThemeCheck", instance, ours, theirs]);
        // The app keeps settings only for what the instance has, and lists sigs it knows with none.
        const relevant = (t: Theme): Theme => ({
            ...t,
            types: Object.fromEntries(Object.entries(t.types).filter(([, s]) => Object.keys(s).length > 0)),
            sets: Object.fromEntries(Object.entries(t.sets).filter(([key]) => !key.startsWith("$Show_p:")))
        });
        expect(relevant(parseTheme(fs.readFileSync(theirs, "utf-8")))).toEqual(relevant(theme));
    });
});

describe("drawing under a theme", () => {
    test("hotel.thm renders the hotel counterexample as the app does: Time projected, keys as attributes", () => {
        const dot = render(hotel.states[0], parseTheme(fixture("hotel.thm")));
        expect(dot).not.toMatch(/"Time\$\d+"/);
        expect(dot).not.toMatch(/"Key\$\d+" \[/);
        expect(dot).toMatch(/"Room\$0" \[label="Room\\n\$NoIntruder_r\\nkey: K\d"/);
        expect(dot).toMatch(/"Desk\$0" \[label="Desk\\nprev: Room->K\d"/);
    });

    test("genealogy.thm colours by sig, inherits shapes, weights spouse", () => {
        const dot = instanceToDot(genealogy.states[0], parseTheme(fixture("genealogy.thm")));
        expect(dot).toContain('"Adam$0" [label="Adam", shape=ellipse, fillcolor="cornflowerblue"');
        expect(dot).toContain('"Eve$0" [label="Eve", shape=ellipse, fillcolor="palevioletred"');
        expect(dot).toMatch(/label="spouse".*weight=10/);
    });

    test("each node and edge option changes the drawing", () => {
        // A second, unconnected Bob, so numbering and hiding unconnected atoms show.
        const state = { ...family.states[0], sigs: family.states[0].sigs.map(s => s.label === "this/Bob" ? { ...s, atoms: [...s.atoms, "Bob$1"] } : s) };
        const base = instanceToDot(state, emptyTheme());
        const differs = (theme: Partial<Theme>) => expect(instanceToDot(state, { ...emptyTheme(), ...theme })).not.toBe(base);
        const person = (settings: Theme["types"][string]) => differs({ types: { Person: settings } });
        const parent = (settings: Theme["relations"][string]) => differs({ relations: { [relationKey("parent", ["Person", "Person"])]: settings } });
        person({ visible: false }); person({ label: "P" }); person({ color: "Red" }); person({ shape: "Hexagon" });
        person({ style: "Dotted" }); person({ numberAtoms: false }); person({ hideUnconnected: true });
        parent({ visible: false }); parent({ label: "mum" }); parent({ color: "Black" }); parent({ style: "Bold" });
        parent({ weight: 5 }); parent({ attribute: true }); parent({ constraint: false }); parent({ layoutBack: true });
        differs({ nodePalette: "Neon" }); differs({ edgePalette: "Martha" }); differs({ fontSize: 18 }); differs({ useOriginalAtomNames: true });
        // Merging only shows with opposing arcs.
        const opposing = { ...state, fields: [{ ...state.fields[1], tuples: [["Alice$0", "Bob$0"], ["Bob$0", "Alice$0"]] }] };
        expect(instanceToDot(opposing, { ...emptyTheme(), relations: { [relationKey("parent", ["Person", "Person"])]: { merge: false } } }))
            .not.toBe(instanceToDot(opposing, emptyTheme()));
    });

    test("the theme's layouts are accepted by Graphviz", async () => {
        const graphviz = await Graphviz.load();
        expect(graphviz.dot(render(hotel.states[0], parseTheme(fixture("hotel.thm"))))).toContain("<svg");
        expect(graphviz.dot(instanceToDot(genealogy.states[0], parseTheme(fixture("genealogy.thm"))))).toContain("<svg");
    });
});

describe("projection", () => {
    test("projecting over Time keeps the tuples of the picked time, minus that column", () => {
        const state = hotel.states[0];
        expect(projectableSigs(state).map(s => s.label)).toContain("this/Time");
        const times = projectionAtoms(state, "Time");
        expect(times.length).toBeGreaterThan(1);
        const projected = projectState(state, { Time: times[0] });
        expect(projected.sigs.flatMap(s => s.atoms).some(a => a.startsWith("Time$"))).toBe(false);
        const key = projected.fields.find(f => f.label === "key")!;
        expect(key.types).toHaveLength(2);
        const original = state.fields.find(f => f.label === "key")!;
        expect(key.tuples).toEqual(original.tuples.filter(t => t[2] === times[0]).map(t => t.slice(0, 2)));
    });
});

describe("Magic Layout", () => {
    test("projects over Time, hides the ordering's sig, and colours top-level sigs apart", () => {
        const theme = magicLayout(hotel.states[0], false);
        expect(theme.projection).toEqual(["Time"]);
        expect(theme.types["timeOrder/Ord"]).toEqual({ visible: false });
        const colours = Object.values(theme.types).map(t => t.color).filter(Boolean);
        expect(new Set(colours).size).toBe(colours.length);
    });

    test("never projects Alloy 6 traces, and makes skolem sets bold", () => {
        const theme = magicLayout(hotel.states[0], true);
        expect(theme.projection).toEqual([]);
        expect(Object.values(theme.sets).every(s => s.style === "Bold")).toBe(true);
        expect(Object.keys(theme.sets).length).toBeGreaterThan(0);
    });
});

describe.skipIf(!haveJava)("instance as predicate", () => {
    const session = new AlloySession({ jar, sessionJar });
    afterAll(() => session.dispose());

    test("the predicate of an instance is satisfiable in its model", { timeout: 120_000 }, async () => {
        const model = path.join(scratch, "family.als");
        fs.writeFileSync(model, [
            "abstract sig Person { parent: lone Person }",
            "one sig Alice extends Person {}",
            "sig Bob extends Person { likes: Person -> Person }",
            instanceAsPredicate(family.states[0]),
            "run instance for 3"
        ].join("\n"));
        expect(instanceAsPredicate(family.states[0])).toContain("Person<:parent = Alice_0->Bob_0 + Bob_0->Bob_0");
        const solution = await session.run(model, 0);
        expect(solution.satisfiable).toBe(true);
    });
});
