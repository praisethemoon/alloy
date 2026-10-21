/*
 * The AlloyTools model corpus: no false diagnostics on models the Analyzer accepts.
 * Fetch the models once with `npm run corpus:fetch`, then run `npm run test:corpus`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true
        },
        include: ['test/corpus/**/*.test.ts']
    }
});
