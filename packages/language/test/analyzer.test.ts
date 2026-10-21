import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expandHome } from "alloy-lsp-language";
import { alloyServices, parse } from "./helpers.js";
import { testJar as jar } from "./alloy-jar.js";

const model = `sig Node { next: lone Node }
pred cycle { some n: Node | n in n.^next }
assert noSelf { no n: Node | n = n.next }
assert finite { #Node < 100 }
run cycle for 3
check noSelf for 3
check finite for 3
`;

/** Writes the model to a fresh folder and opens it as a file document. */
async function modelOnDisk(text: string) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-test-"));
    const file = path.join(folder, "model.als");
    fs.writeFileSync(file, text);
    return { file, document: await parse(text, `file://${file}`) };
}

async function useJar(value: string | undefined): Promise<void> {
    const services = await alloyServices();
    services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { "alloy-lsp": { analyzer: { jar: value ?? "" } } } });
}

describe("paths in settings", () => {
    test("a leading ~ is the home folder; other paths are kept", () => {
        expect(expandHome("~/tools/alloy.jar")).toBe(path.join(os.homedir(), "tools/alloy.jar"));
        expect(expandHome("~")).toBe(os.homedir());
        expect(expandHome("/opt/alloy.jar")).toBe("/opt/alloy.jar");
        expect(expandHome("lib/~/alloy.jar")).toBe("lib/~/alloy.jar");
        expect(expandHome(undefined)).toBeUndefined();
    });
});

/** Runs `body` with the analyzer's shipped jar set to `shipped`, then puts the old one back. */
async function withShippedJar(shipped: string | undefined, body: () => Promise<void>): Promise<void> {
    const analyzer = (await alloyServices()).AlloyLsp.analysis.Analyzer;
    const saved = analyzer.bundledJar;
    analyzer.bundledJar = shipped;
    try {
        await body();
    } finally {
        analyzer.bundledJar = saved;
    }
}

describe("without a jar", () => {
    test("with none shipped and none set, running says to set one", async () => {
        await withShippedJar(undefined, async () => {
            await useJar(undefined);
            const services = await alloyServices();
            const { document } = await modelOnDisk(model);
            const result = await services.AlloyLsp.analysis.Analyzer.run(document, 0);
            expect(result.error).toBe("No Alloy jar: this editor ships none, so set alloy-lsp.analyzer.jar to an Alloy 6 jar.");
        });
    });

    test("a missing shipped jar says to rebuild, a missing set jar to check the setting", async () => {
        const services = await alloyServices();
        const { document } = await modelOnDisk(model);
        await withShippedJar("/nonexistent/shipped/alloy.jar", async () => {
            await useJar(undefined);
            expect((await services.AlloyLsp.analysis.Analyzer.run(document, 0)).error).toBe(
                "The shipped Alloy jar /nonexistent/shipped/alloy.jar is missing; rebuild the extension (npm run fetch:alloy) or set alloy-lsp.analyzer.jar.");
            await useJar("/nonexistent/set/alloy.jar");
            expect((await services.AlloyLsp.analysis.Analyzer.run(document, 0)).error).toBe(
                "The Alloy jar /nonexistent/set/alloy.jar does not exist; check alloy-lsp.analyzer.jar.");
        });
    });

    test("every command gets a lens before anything has run", async () => {
        const services = await alloyServices();
        const { document } = await modelOnDisk(model);
        const lenses = await services.AlloyLsp.lsp.CodeLensProvider!.provideCodeLens(document, { textDocument: { uri: document.uri.toString() } });
        expect(lenses?.map(l => `${l.range.start.line + 1} ${l.command?.title} ${JSON.stringify(l.command?.arguments?.[1])}`)).toEqual([
            "5 ▶ Run 0", "6 ▶ Check 1", "7 ▶ Check 2"
        ]);
    });
});

describe.skipIf(!jar)("with the Alloy jar", () => {
    test("a run finds an instance; a failing check a counterexample; a holding check none", { timeout: 120_000 }, async () => {
        await useJar(jar);
        const services = await alloyServices();
        const { document } = await modelOnDisk(model);
        const analyzer = services.AlloyLsp.analysis.Analyzer;
        const [run, failing, holding] = [await analyzer.run(document, 0), await analyzer.run(document, 1), await analyzer.run(document, 2)];
        expect([run.kind, run.name, run.outcome]).toEqual(["run", "cycle", "instance"]);
        expect([failing.kind, failing.name, failing.outcome]).toEqual(["check", "noSelf", "counterexample"]);
        expect([holding.kind, holding.name, holding.outcome]).toEqual(["check", "finite", "no-counterexample"]);
        expect(typeof failing.durationMs).toBe("number");
        expect(fs.readFileSync(failing.solutionFile!, "utf-8")).toContain("noSelf");
        expect(holding.solutionFile).toBeUndefined();
    });

    test("the lenses show each command's outcome after it has run", { timeout: 120_000 }, async () => {
        await useJar(jar);
        const services = await alloyServices();
        const { document } = await modelOnDisk(model);
        await services.AlloyLsp.analysis.Analyzer.run(document, 1);
        const lenses = await services.AlloyLsp.lsp.CodeLensProvider!.provideCodeLens(document, { textDocument: { uri: document.uri.toString() } });
        expect(lenses?.[1].command?.title).toMatch(/^▶ Check again · counterexample found \(\d+ ms\)$/);
        expect(lenses?.[0].command?.title).toBe("▶ Run");
    });

    test.skipIf(!jar?.startsWith(os.homedir()))("a jar setting written with ~ runs", { timeout: 120_000 }, async () => {
        await useJar("~" + jar!.slice(os.homedir().length));
        const services = await alloyServices();
        const { document } = await modelOnDisk(model);
        expect((await services.AlloyLsp.analysis.Analyzer.run(document, 2)).outcome).toBe("no-counterexample");
    });

    test("a run past the timeout stops and says so, and 0 means no limit", { timeout: 120_000 }, async () => {
        const services = await alloyServices();
        const configure = (timeoutSeconds: number) => services.shared.workspace.ConfigurationProvider.updateConfiguration({
            settings: { "alloy-lsp": { analyzer: { jar, timeoutSeconds } } }
        });
        const { document } = await modelOnDisk(model);
        // Starting java alone takes longer than this.
        configure(0.2);
        const stopped = await services.AlloyLsp.analysis.Analyzer.run(document, 2);
        expect([stopped.timedOut, stopped.error]).toEqual([true, "Stopped after 0.2 s, the alloy-lsp.analyzer.timeoutSeconds limit."]);
        configure(0);
        const unlimited = await services.AlloyLsp.analysis.Analyzer.run(document, 2);
        expect([unlimited.timedOut, unlimited.outcome]).toEqual([undefined, "no-counterexample"]);
    });

    test("an empty jar setting runs the shipped jar", { timeout: 120_000 }, async () => {
        await withShippedJar(jar, async () => {
            await useJar(undefined);
            const services = await alloyServices();
            const { document } = await modelOnDisk(model);
            expect((await services.AlloyLsp.analysis.Analyzer.run(document, 2)).outcome).toBe("no-counterexample");
        });
    });

    test("a jar setting wins over the shipped jar", { timeout: 120_000 }, async () => {
        await withShippedJar("/nonexistent/shipped/alloy.jar", async () => {
            await useJar(jar);
            const services = await alloyServices();
            const { document } = await modelOnDisk(model);
            expect((await services.AlloyLsp.analysis.Analyzer.run(document, 2)).outcome).toBe("no-counterexample");
        });
    });

    test("a model the Analyzer cannot parse reports its syntax error", { timeout: 120_000 }, async () => {
        await useJar(jar);
        const services = await alloyServices();
        const { file } = await modelOnDisk("sig A { f: }\nrun {}\n");
        const result = await services.AlloyLsp.analysis.Analyzer.runFile(file, 0);
        // The Analyzer names the file by its resolved path (/private/var/... on macOS).
        expect(result.error).toBe(`Syntax error in ${fs.realpathSync(file)} at line 1 column 12`);
    });
});
