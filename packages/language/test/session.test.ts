import { afterAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AlloySession, SessionError } from "alloy-lsp-language";
import { sessionJar, testJar } from "./alloy-jar.js";

// The Java session helper behind the visualizer, driven as the extension drives it.

const ready = !!testJar && fs.existsSync(sessionJar);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-session-"));

function model(name: string, text: string): string {
    const file = path.join(folder, name);
    fs.writeFileSync(file, text);
    return file;
}

const staticModel = model("static.als", `sig Node { succ: lone Node }
run show { some succ } for 3
check atMostOne { all n: Node | lone n.succ } for 3
`);

const temporalModel = model("temporal.als", `sig Node { var edges: set Node }
fact { always some edges }
run show { eventually no edges & iden } for 3 but 3 steps
`);

const sessions: AlloySession[] = [];
function open(java?: string): AlloySession {
    const session = new AlloySession({ java, jar: testJar!, sessionJar });
    sessions.push(session);
    return session;
}
afterAll(() => sessions.forEach(s => s.dispose()));

describe.skipIf(!ready)("the Alloy session helper", () => {

    test("runs a command and enumerates solutions with Next", { timeout: 120_000 }, async () => {
        const session = open();
        const first = await session.run(staticModel, 0);
        expect(first).toMatchObject({ command: "show", kind: "run", satisfiable: true, incremental: true, traceLength: 1 });
        expect(first.xml).toContain("<instance");
        const second = await session.move("next");
        expect(second.satisfiable).toBe(true);
        expect(second.xml).not.toBe(first.xml);
    });

    test("evaluates expressions in the current instance, and reports a bad one with its position", { timeout: 120_000 }, async () => {
        const session = open();
        await session.run(staticModel, 0);
        expect(await session.evaluate("some succ")).toBe("true");
        expect(await session.evaluate("#Node > 0")).toBe("true");
        const error = await session.evaluate("no such thing").catch(e => e);
        expect(error).toBeInstanceOf(SessionError);
        expect(error.message).toBe('The name "such" cannot be found.');
        expect(error.pos).toMatchObject({ line: 1, column: 4 });
        expect(await session.evaluate("Node = Node")).toBe("true");
    });

    test("New Config, New Init, New Fork and New Trace behave as in the app", { timeout: 120_000 }, async () => {
        const session = open();
        const run = await session.run(temporalModel, 0);
        expect(run).toMatchObject({ satisfiable: true, newTraceAllowed: true });
        expect(run.loopState).toBeGreaterThanOrEqual(0);
        expect((await session.move("trace")).newTraceAllowed).toBe(true);
        const init = await session.move("init");
        expect(init.newTraceAllowed).toBe(false);
        await expect(session.move("trace")).rejects.toThrow("A new trace can't follow New Init or New Fork; use New Config first.");
        const fork = await session.move("fork", 0);
        expect([fork.satisfiable, fork.newTraceAllowed]).toEqual([true, false]);
        expect((fork.xml!.match(/<instance/g) ?? []).length).toBe(fork.traceLength);
        expect((await session.move("config")).newTraceAllowed).toBe(true);
        expect((await session.move("trace")).satisfiable).toBe(true);
    });

    test("evaluates in a chosen state of a trace", { timeout: 120_000 }, async () => {
        const session = open();
        await session.run(temporalModel, 0);
        const fork = await session.move("fork", 0);
        for (let state = 0; state < fork.traceLength!; state++) {
            expect(await session.evaluate("some edges", state)).toBe("true");
        }
    });

    test("a check that holds is unsatisfiable and reports its core positions", { timeout: 120_000 }, async () => {
        const session = open();
        const plain = await session.run(staticModel, 1);
        expect([plain.kind, plain.satisfiable, plain.xml]).toEqual(["check", false, undefined]);
        await expect(session.move("next")).rejects.toThrow("This command is unsatisfiable, so there are no solutions to enumerate.");
    });

    test("MiniSat's prover gives the unsat core: the facts that matter, not the others", { timeout: 120_000 }, async () => {
        const pigeons = model("pigeons.als", `sig Pigeon { hole: one Hole }
sig Hole {}
fact injective { all disj p, q: Pigeon | p.hole != q.hole }
fact unrelated { some Hole }
run crowded {} for exactly 5 Pigeon, exactly 4 Hole
`);
        const session = open();
        for (const coreMinimization of [0, 1, 2]) {
            const result = await session.run(pigeons, 0, { solver: "minisat.prover", coreMinimization });
            expect(result.satisfiable).toBe(false);
            const lines = result.core!.map(p => p.line).sort();
            expect(lines, `minimisation ${coreMinimization}`).toEqual([1, 3]);
            expect(result.core!.find(p => p.line === 3)).toMatchObject({ column: 18, endLine: 3, endColumn: 57 });
        }
        expect((await session.run(pigeons, 0)).core).toEqual([]);
    });

    test("shows the metamodel", { timeout: 120_000 }, async () => {
        const session = open();
        await session.run(staticModel, 0);
        const xml = await session.metamodel();
        expect(xml).toContain('label="this/Node"');
        expect(xml).toContain('label="succ"');
    });

    test("lists the sample themes inside the Alloy jar", { timeout: 120_000 }, async () => {
        const themes = await open().sampleThemes();
        expect(themes.map(t => t.path)).toContain("models/book/appendixE/hotel.thm");
        expect(themes.find(t => t.path.endsWith("hotel.thm"))!.text).toContain("<view>");
    });

    test("errors come back as errors and the helper keeps going", { timeout: 120_000 }, async () => {
        const session = open();
        await expect(session.move("next")).rejects.toThrow("Nothing has been run yet.");
        await expect(session.run(staticModel, 7)).rejects.toThrow("The model has 2 commands; there is none with index 7.");
        await expect(session.run(staticModel, 0, { solver: "nonesuch" })).rejects.toThrow("Unknown solver nonesuch.");
        const broken = model("broken.als", "sig A { f: }\nrun {}\n");
        const parse = await session.run(broken, 0).catch(e => e);
        expect(parse).toBeInstanceOf(SessionError);
        expect(parse.pos).toMatchObject({ line: 1, column: 12 });
        expect((await session.run(staticModel, 0)).satisfiable).toBe(true);
    });

    test("a helper that dies rejects what is pending and restarts on the next request", { timeout: 120_000 }, async () => {
        const session = open();
        await session.run(staticModel, 0);
        session.dispose();
        expect((await session.run(staticModel, 0)).satisfiable).toBe(true);
    });

    test("a java that can't start is reported", async () => {
        const session = open("/nonexistent/java");
        await expect(session.run(staticModel, 0)).rejects.toThrow("Could not start the Alloy session (/nonexistent/java)");
    });
});

describe("restarting the helper", () => {
    // A stand-in helper, run in place of java: it answers every request after a
    // pause, so a killed helper's exit always arrives before its successor replies.
    const slowHelper = path.join(folder, "slow-helper.cjs");
    fs.writeFileSync(slowHelper, `#!/usr/bin/env node
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
    const { id } = JSON.parse(line);
    setTimeout(() => process.stdout.write(JSON.stringify({ id, ok: true, value: "answer" }) + "\\n"), 500);
});
`, { mode: 0o755 });

    test("the old helper's exit does not fail the new helper's requests", async () => {
        const session = new AlloySession({ java: slowHelper, jar: "unused.jar", sessionJar: "unused.jar" });
        sessions.push(session);
        expect(await session.evaluate("x")).toBe("answer");
        session.dispose();
        expect(await session.evaluate("x")).toBe("answer");
    });
});
