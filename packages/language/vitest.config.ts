/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://vitest.dev/config/
 */
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true
        },
        include: ['**/*.test.ts'],
        // The Analyzer oracle starts a JVM per case; it runs on its own with `npm run test:oracle`.
        exclude: [...configDefaults.exclude, 'test/oracle/**']
    }
});
