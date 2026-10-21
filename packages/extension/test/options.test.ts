import { afterAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AlloySession, type SessionRunOptions } from "alloy-lsp-language";
import { jvmArgsFrom, runOptionsFrom, type SettingReader } from "../src/extension/options.js";

// The app's options, as settings: their mapping to the solver's options, and
// their effect on real runs through the session helper the extension ships.

const reader = (settings: Record<string, unknown>): SettingReader =>
    (key, fallback) => (key in settings ? settings[key] : fallback) as typeof fallback;

describe("settings as solver options", () => {
    test("the defaults are A4Options' own", () => {
        expect(runOptionsFrom(reader({}))).toEqual({
            solver: "sat4j", skolemDepth: 0, unrolls: -1, symmetry: 20, noOverflow: false, coreMinimization: 2,
            coreGranularity: 0, decompose: 0, inferPartialInstance: true, recordKodkod: false, allowWarnings: true
        });
        expect(jvmArgsFrom(reader({}))).toEqual([]);
    });

    test("the app's choices map to its numbers", () => {
        const options = runOptionsFrom(reader({
            recursionDepth: 3, unsatCoreMinimization: "slow", unsatCoreGranularity: "expand-quantifiers", decompose: "parallel"
        }));
        expect([options.unrolls, options.coreMinimization, options.coreGranularity, options.decompose]).toEqual([3, 0, 3, 2]);
        expect(runOptionsFrom(reader({ unsatCoreMinimization: "medium" })).coreMinimization).toBe(1);
        expect(jvmArgsFrom(reader({ maxMemoryMB: 2048, maxStackKB: 8192 }))).toEqual(["-Xmx2048m", "-Xss8192k"]);
    });
});

const jar = path.join(__dirname, "../alloy/alloy.jar");
const sessionJar = path.join(__dirname, "../alloy/alloy-session.jar");
const ready = fs.existsSync(jar) && fs.existsSync(sessionJar);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-options-"));
const model = (name: string, text: string) => {
    const file = path.join(folder, name);
    fs.writeFileSync(file, text);
    return file;
};

describe.skipIf(!ready)("each option changes the analysis", () => {
    const sessions: AlloySession[] = [];
    const open = (jvmArgs?: string[]) => {
        const session = new AlloySession({ jar, sessionJar, jvmArgs });
        sessions.push(session);
        return session;
    };
    afterAll(() => sessions.forEach(s => s.dispose()));
    const run = (file: string, options: SessionRunOptions) => open().run(file, 0, options);

    test("Prevent overflows: an overflowing increment is an instance only when overflows wrap", { timeout: 120_000 }, async () => {
        const overflow = model("overflow.als", "run overflow { some i: Int | plus[i, 1] < i } for 4 Int\n");
        expect((await run(overflow, { noOverflow: false })).satisfiable).toBe(true);
        expect((await run(overflow, { noOverflow: true })).satisfiable).toBe(false);
    });

    test("Recursion depth: a recursive fun is refused when disabled and unrolled when set", { timeout: 120_000 }, async () => {
        const recursion = model("recursion.als", "fun depth[n: Int]: Int { n <= 0 => 0 else plus[1, depth[minus[n, 1]]] }\nrun recursive { depth[2] = 2 } for 4 Int\n");
        await expect(run(recursion, runOptionsFrom(reader({})))).rejects.toThrow("cannot call itself recursively");
        expect((await run(recursion, runOptionsFrom(reader({ recursionDepth: 3 })))).satisfiable).toBe(true);
    });

    test("Allow warnings: the Analyzer's warnings are reported, and stop the run when not allowed", { timeout: 120_000 }, async () => {
        const warned = model("warned.als", "sig A {}\nrun redundant { all a: A | a != a } for 2\n");
        const allowed = await run(warned, { allowWarnings: true });
        expect(allowed.warnings!.map(w => w.message)).toEqual([expect.stringContaining("is redundant")]);
        expect(allowed.warnings![0].pos).toMatchObject({ line: 2 });
        await expect(run(warned, { allowWarnings: false })).rejects.toThrow("is redundant");
    });

    test("Record the Kodkod input/output: the run carries the Kodkod program", { timeout: 120_000 }, async () => {
        const small = model("small.als", "sig A {}\nrun some2 { some A } for 2\n");
        expect((await run(small, { recordKodkod: false })).kodkod).toBeUndefined();
        expect((await run(small, { recordKodkod: true })).kodkod).toMatch(/Relation|Formula|Solver/);
    });

    test("Symmetry breaking: with it off, isomorphic instances are enumerated too", { timeout: 120_000 }, async () => {
        const graphs = model("graphs.als", "sig A { r: lone A }\nrun all2 {} for exactly 2 A\n");
        const count = async (symmetry: number) => {
            const session = open();
            let n = (await session.run(graphs, 0, { symmetry })).satisfiable ? 1 : 0;
            while (n < 50 && (await session.move("next")).satisfiable) n++;
            return n;
        };
        expect(await count(20)).toBeLessThan(await count(0));
    });

    test("Solver and decompose strategy: other solvers and strategies solve too", { timeout: 120_000 }, async () => {
        const small = model("small2.als", "sig A {}\nrun some2 { some A } for 2\n");
        expect((await run(small, { solver: "minisat" })).satisfiable).toBe(true);
        expect((await run(small, { decompose: 2 })).satisfiable).toBe(true);
    });

    test("Maximum memory: the JVM options reach the solver's process", { timeout: 120_000 }, async () => {
        const small = model("small3.als", "sig A {}\nrun some2 { some A } for 2\n");
        await expect(open(["-Xmx1k"]).run(small, 0)).rejects.toThrow("The Alloy session stopped");
        expect((await open(["-Xmx512m", "-Xss4m"]).run(small, 0)).satisfiable).toBe(true);
    });
});
