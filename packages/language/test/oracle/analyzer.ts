import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The Alloy jar to compare against: ALLOY_JAR, else a known local install; the oracle suite skips without one. */
export const oracleJar = [process.env.ALLOY_JAR, path.join(os.homedir(), "code/tools/alloy/alloy-6.2.0.jar")]
    .find((candidate): candidate is string => !!candidate && fs.existsSync(candidate));

/**
 * What the Analyzer made of a model. It reports many checks made after
 * parsing (unknown names, an empty enum, a repeated scope) as syntax errors
 * too; only a list of expected tokens or one of the lexer's own errors is a
 * parse error here, and the rest are semantic errors.
 */
export interface Verdict {
    kind: "accepted" | "parse-error" | "semantic-error" | "unresolved" | "type-error" | "other-error";
    /** Whether the Analyzer printed a warning (it still accepts the model). */
    warning: boolean;
    /** The Analyzer's own message, to show when a test disagrees with it. */
    message: string;
}

/**
 * The messages of CompParser's syntax_error (the expected tokens) and of the
 * lexer's error rules in Alloy.lex (kb D-26): bad names, numbers, strings
 * and characters.
 */
const parseErrorMessages = /possible tokens that can appear here|Name cannot start with a number|The (hex |binary )?number .* (is out of range|java\.lang)|String literal|Syntax error at the .* character/;

/** Writes `text` to a scratch file and asks the Analyzer to parse and type it. */
export async function verdictOf(text: string): Promise<Verdict> {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "alloy-oracle-"));
    const file = path.join(folder, "model.als");
    fs.writeFileSync(file, text);
    return verdictOfFile(file);
}

/** Runs the jar's `commands` subcommand, which parses, resolves and type-checks a model without solving it. */
export function verdictOfFile(file: string): Promise<Verdict> {
    return new Promise(resolve => {
        execFile("java", ["-Djava.awt.headless=true", "-jar", oracleJar!, "commands", file], { timeout: 120_000 }, (error, stdout, stderr) => {
            const output = `${stdout}\n${stderr}`;
            const warning = /\bWarning\b/.test(output);
            if (!error) {
                resolve({ kind: "accepted", warning, message: "" });
                return;
            }
            const header = /(Syntax|Type) error in .* at line \d+ column \d+:\n(?:Error\n)?(.*)/.exec(output);
            const message = header ? header[2].trim() : output.split("\n").find(line => line.trim()) ?? String(error);
            const kind = !header ? "other-error"
                : header[1] === "Type" ? "type-error"
                : /cannot be found/.test(output) ? "unresolved"
                : parseErrorMessages.test(message) ? "parse-error" : "semantic-error";
            resolve({ kind, warning, message });
        });
    });
}
