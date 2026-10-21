import { describe, expect, test } from "vitest";
import { parse, syntaxErrors } from "./helpers.js";
import { invalidSyntax } from "./cases/syntax-cases.js";

describe("invalid Alloy syntax", () => {
    test.each(invalidSyntax)("%s is rejected", async (_name, text) => {
        const document = await parse(text);
        expect(syntaxErrors(document).length).toBeGreaterThan(0);
    });
});
