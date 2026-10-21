import { afterAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { AlloySession, commandCalls, createAlloyLspServices, type Specification } from "alloy-lsp-language";
import { EmptyFileSystem, URI } from "langium";
import { parseInstance } from "../src/visualizer/instance.js";
import { instanceToDot } from "../src/visualizer/dot.js";
import { instanceToTables, instanceToText, instanceToTree } from "../src/visualizer/views.js";

// Every command of the examples, solved by the session helper the extension
// ships and shown through every view, as the visualizer would.

const root = path.resolve(__dirname, "../../..");
const jar = path.join(__dirname, "../alloy/alloy.jar");
const sessionJar = path.join(__dirname, "../alloy/alloy-session.jar");
const ready = fs.existsSync(jar) && fs.existsSync(sessionJar);
const examples = fs.readdirSync(path.join(root, "examples"), { recursive: true, encoding: "utf-8" })
    .filter(f => f.endsWith(".als") && !f.startsWith("lib/")).sort();

const services = createAlloyLspServices(EmptyFileSystem);
function commandCount(file: string): number {
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(fs.readFileSync(file, "utf-8"), URI.file(file));
    return commandCalls(doc.parseResult.value as Specification).length;
}

const session = new AlloySession({ jar, sessionJar });
afterAll(() => session.dispose());

describe.skipIf(!ready)("the visualizer on the examples", () => {
    test.each(examples)("%s: every command's solution renders in every view", { timeout: 300_000 }, async example => {
        const file = path.join(root, "examples", example);
        const graphviz = await Graphviz.load();
        let shown = 0;
        for (let index = 0; index < commandCount(file); index++) {
            const solution = await session.run(file, index);
            if (!solution.satisfiable) continue;
            const instance = parseInstance(solution.xml!);
            expect(instance.states).toHaveLength(instance.traceLength);
            for (const state of instance.states) {
                expect(graphviz.dot(instanceToDot(state))).toContain("<svg");
                expect(instanceToText(state)).toContain("univ=");
                instanceToTables(state);
                instanceToTree(state);
            }
            shown++;
        }
        expect(shown, "at least one command of each example has an instance").toBeGreaterThan(0);
    });
});
