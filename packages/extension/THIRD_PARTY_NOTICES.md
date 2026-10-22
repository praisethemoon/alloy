# Third-party software

The Alloy extension is MIT-licensed (see LICENSE). It ships the following
software by others, unmodified, each under its own licence.

## The Alloy Analyzer

`alloy/alloy.jar` is Alloy 6.2.0 from AlloyTools
(<https://github.com/AlloyTools/org.alloytools.alloy>), MIT. The jar carries
the licences of the solvers and libraries inside it in its `LICENSES/` and
`META-INF/` folders: Kodkod, Electrod, SAT4J, MiniSat, Glucose, Lingeling,
Gini and Apache Commons IO.

`alloy/alloy-session.jar` is this extension's own helper, MIT, built from
`java/alloylsp/` against the Alloy jar.

## Bundled into `out/`

| Package | Version | Licence |
| --- | --- | --- |
| Graphviz, compiled to WebAssembly inside @hpcc-js/wasm-graphviz | 16.1.0 | EPL-1.0 |
| @hpcc-js/wasm-graphviz | 1.30.0 | Apache-2.0 |
| fzstd, inside @hpcc-js/wasm-graphviz | | MIT |
| baukasten-ui | 0.3.0 | MIT |
| react, react-dom, scheduler | 19.3.1, 19.3.1, 0.28.0 | MIT |
| langium | 4.4.0 | MIT |
| chevrotain, @chevrotain/gast, @chevrotain/regexp-to-ast, @chevrotain/utils | 13.2.0 | Apache-2.0 |
| chevrotain-allstar | 0.5.0 | MIT |
| lodash-es | 4.18.1 | MIT |
| vscode-languageclient, vscode-languageserver | 10.1.2 | MIT |
| vscode-languageserver-protocol, vscode-languageserver-types | 3.18.4 | MIT |
| vscode-languageserver-textdocument | 1.0.15 | MIT |
| vscode-jsonrpc | 9.0.3 | MIT |
| vscode-uri, with path-browserify inside | 3.1.0 | MIT |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| brace-expansion, balanced-match | 5.0.12, 4.0.4 | MIT |

The licence texts: MIT <https://opensource.org/license/mit>, Apache-2.0
<https://www.apache.org/licenses/LICENSE-2.0>, EPL-1.0
<https://www.eclipse.org/legal/epl-v10.html>, BlueOak-1.0.0
<https://blueoakcouncil.org/license/1.0.0>. Each package's own copy is in
its npm package.
