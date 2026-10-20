import type { Specification } from 'alloy-lsp-language';
import { createAlloyLspServices, AlloyLspLanguageMetaData } from 'alloy-lsp-language';
import chalk from 'chalk';
import { Command } from 'commander';
import { extractAstNode } from './util.js';
import { NodeFileSystem } from 'langium/node';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export const parseAction = async (fileName: string): Promise<void> => {
    const services = createAlloyLspServices(NodeFileSystem).AlloyLsp;
    const spec = await extractAstNode<Specification>(fileName, services);
    const counts = new Map<string, number>();
    for (const paragraph of spec.paragraphs) {
        counts.set(paragraph.$type, (counts.get(paragraph.$type) ?? 0) + 1);
    }
    const summary = [...counts].map(([type, count]) => `${count} ${type}`).join(', ');
    console.log(chalk.green(`${fileName} parsed: ${spec.opens.length} open, ${summary || 'no paragraphs'}`));
};

export default function(): void {
    const program = new Command();

    program.version(JSON.parse(packageContent).version);

    const fileExtensions = AlloyLspLanguageMetaData.fileExtensions.join(', ');
    program
        .command('parse')
        .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
        .description('parses an Alloy model and reports syntax errors')
        .action(parseAction);

    program.parse(process.argv);
}
