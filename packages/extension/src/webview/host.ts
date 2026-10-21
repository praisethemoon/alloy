import { Graphviz } from '@hpcc-js/wasm-graphviz';
import type { FromWebview } from '../visualizer/protocol.js';

interface VsCodeApi {
    postMessage(message: FromWebview): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** The extension host on the other side of the webview. */
export const host = acquireVsCodeApi();

let graphviz: Promise<Graphviz> | undefined;

/** Graphviz compiled to WebAssembly, loaded on first use and kept. */
export function loadGraphviz(): Promise<Graphviz> {
    graphviz ??= Graphviz.load();
    return graphviz;
}
