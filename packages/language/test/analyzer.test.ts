import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { alloyServices, parse } from "./helpers.js";

/** The Alloy jar to test against: ALLOY_JAR, else a known local install; these tests skip without one. */
const jar = [process.env.ALLOY_JAR, path.join(os.homedir(), "code/tools/alloy/alloy-6.2.0.jar")]
    .find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

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

describe("without a jar", () => {
    test("running explains how to configure one", async () => {
        const saved = process.env.ALLOY_JAR;
        delete process.env.ALLOY_JAR;
        try {
            await useJar(undefined);
            const services = await alloyServices();
            const { document } = await modelOnDisk(model);
            const result = await services.AlloyLsp.analysis.Analyzer.run(document, 0);
            expect(result.error).toBe("No Alloy jar configured: set alloy-lsp.analyzer.jar (or ALLOY_JAR) to the Alloy 6 jar.");
        } finally {
            if (saved !== undefined) process.env.ALLOY_JAR = saved;
        }
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

    test("a model the Analyzer cannot parse reports its syntax error", { timeout: 120_000 }, async () => {
        await useJar(jar);
        const services = await alloyServices();
        const { file } = await modelOnDisk("sig A { f: }\nrun {}\n");
        const result = await services.AlloyLsp.analysis.Analyzer.runFile(file, 0);
        // The Analyzer names the file by its resolved path (/private/var/... on macOS).
        expect(result.error).toBe(`Syntax error in ${fs.realpathSync(file)} at line 1 column 12`);
    });
});
