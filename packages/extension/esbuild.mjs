//@ts-check
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const success = watch ? 'Watch build succeeded' : 'Build succeeded';

function getTime() {
    const date = new Date();
    return `[${`${padZeroes(date.getHours())}:${padZeroes(date.getMinutes())}:${padZeroes(date.getSeconds())}`}] `;
}

function padZeroes(i) {
    return i.toString().padStart(2, '0');
}

const plugins = [{
    name: 'watch-plugin',
    setup(build) {
        build.onEnd(result => {
            if (result.errors.length === 0) {
                console.log(getTime() + success);
            }
        });
    },
}];

const ctx = await esbuild.context({
    // Entry points for the vscode extension and the language server
    entryPoints: ['src/extension/main.ts', 'src/language/main.ts'],
    outdir: 'out',
    bundle: true,
    target: "ES2017",
    // VSCode's extension host is still using cjs, so we need to transform the code
    format: 'cjs',
    // To prevent confusing node, we explicitly use the `.cjs` extension
    outExtension: {
        '.js': '.cjs'
    },
    loader: { '.ts': 'ts' },
    external: ['vscode'],
    platform: 'node',
    sourcemap: !minify,
    minify,
    plugins
});

// The webviews (the visualizer and the Alloy log): React with baukasten-ui, and Graphviz
// (WASM inlined) for the visualizer, for the browser. CSS imports go to out/webview/<name>.css.
const webview = await esbuild.context({
    entryPoints: { visualizer: 'src/webview/main.tsx', log: 'src/webview/log.tsx' },
    outdir: 'out/webview',
    bundle: true,
    target: 'ES2022',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.ts': 'ts', '.tsx': 'tsx' },
    define: { 'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development') },
    sourcemap: !minify,
    minify,
    plugins
});

if (watch) {
    await Promise.all([ctx.watch(), webview.watch()]);
} else {
    await Promise.all([ctx.rebuild(), webview.rebuild()]);
    ctx.dispose();
    webview.dispose();
}
