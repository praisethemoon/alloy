/*
 * Unit tests of the extension's own logic, such as the visualizer's instance
 * model and views. The webview and VS Code APIs are not loaded here.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts']
    }
});
