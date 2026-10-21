import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { invalidSyntax, validSyntax } from "../cases/syntax-cases.js";
import { typingCases } from "../cases/typing-cases.js";
import { oracleJar, verdictOf, verdictOfFile } from "./analyzer.js";

// Every input the other suites make a claim about, judged by the real
// Analyzer. Run with `npm run test:oracle`; it skips without a jar.

const examplesDir = path.resolve(__dirname, "../../../../examples");
const examples = fs.readdirSync(examplesDir, { recursive: true, encoding: "utf-8" })
    .filter(file => file.endsWith(".als"))
    .sort();

/** Cases where our grammar still disagrees with the Analyzer, and why. */
const knownDisagreements = new Map<string, string>([]);

describe.skipIf(!oracleJar)("the Analyzer agrees", () => {

    describe.concurrent("valid-syntax cases parse", () => {
        // The cases test grammar only, so unknown names and type errors are fine.
        const parses = async (_name: string, text: string) => {
            const verdict = await verdictOf(text);
            expect(verdict.kind, verdict.message).not.toBe("parse-error");
        };
        test.each(validSyntax.filter(([name]) => !knownDisagreements.has(name)))("%s", parses);
        // Expected to fail while our grammar still accepts these; once it agrees, drop the entry.
        const known = validSyntax.filter(([name]) => knownDisagreements.has(name));
        if (known.length > 0) {
            test.fails.each(known)("known disagreement: %s", parses);
        }
    });

    describe.concurrent("invalid-syntax cases are parse errors", () => {
        test.each(invalidSyntax)("%s", async (_name, text) => {
            const verdict = await verdictOf(text);
            expect(verdict.kind, verdict.message).toBe("parse-error");
        });
    });

    describe.concurrent("typing cases: the flawed model fails as we say, the fixed one passes", () => {
        test.each(typingCases)("%s", async (_what, flawed, diagnostic, fixed) => {
            const [flawedVerdict, fixedVerdict] = await Promise.all([verdictOf(flawed), verdictOf(fixed)]);
            const onlyWarnings = [diagnostic].flat().every(d => d.startsWith("warning:"));
            if (onlyWarnings) {
                expect(flawedVerdict, "the Analyzer should accept it with a warning").toMatchObject({ kind: "accepted", warning: true });
            } else {
                expect(flawedVerdict.kind, "the Analyzer should reject it").not.toBe("accepted");
            }
            expect(fixedVerdict.kind, fixedVerdict.message).toBe("accepted");
        });
    });

    describe.concurrent("examples are accepted", () => {
        test.each(examples)("%s", async file => {
            const verdict = await verdictOfFile(path.join(examplesDir, file));
            expect(verdict.kind, verdict.message).toBe("accepted");
        });
    });
});
