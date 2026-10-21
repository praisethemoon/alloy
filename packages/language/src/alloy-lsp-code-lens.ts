import type { LangiumDocument } from 'langium';
import type { CodeLensProvider } from 'langium/lsp';
import type { CodeLens } from 'vscode-languageserver';
import type { AlloyLspServices } from './alloy-lsp-module.js';
import { commandCalls, describeOutcome, type AlloyAnalyzer } from './alloy-lsp-analyzer.js';
import type { Specification } from './generated/ast.js';

/** The client command a lens runs: arguments are the document URI and the command index. */
export const RUN_COMMAND = 'alloy-lsp.runCommand';

/** A ▶ lens above every run and check, carrying its latest outcome once it has run. */
export class AlloyCodeLensProvider implements CodeLensProvider {

    protected readonly analyzer: AlloyAnalyzer;

    constructor(services: AlloyLspServices) {
        this.analyzer = services.analysis.Analyzer;
    }

    provideCodeLens(document: LangiumDocument): CodeLens[] {
        return commandCalls(document.parseResult.value as Specification).flatMap((call, index) => {
            const range = call.$cstNode?.range;
            if (!range) return [];
            const last = this.analyzer.lastResult(document, index);
            const action = call.kind === 'check' ? 'Check' : 'Run';
            return [{
                range,
                command: {
                    title: last ? `▶ ${action} again · ${describeOutcome(last)}` : `▶ ${action}`,
                    command: RUN_COMMAND,
                    arguments: [document.uri.toString(), index]
                }
            }];
        });
    }
}
