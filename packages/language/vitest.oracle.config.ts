/*
 * The Analyzer oracle: our test expectations checked against the real Alloy jar.
 * Run with `npm run test:oracle`; it needs Java and the jar the extension ships (fetched by its build), or ALLOY_JAR.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true
        },
        include: ['test/oracle/**/*.test.ts'],
        // Each case starts a JVM; run several at once and give each time to start.
        maxConcurrency: 8,
        testTimeout: 120_000
    }
});
