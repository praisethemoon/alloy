# Changelog

## 0.1.0 (2026-10-22)

The first release of Alloy Workbench. Running commands needs Java 17 or later.

- **Language server for Alloy 6:** the whole grammar, modules and `open`,
  type checking with Alloy's own rules, and diagnostics checked against the
  Alloy 6.2.0 Analyzer on the AlloyTools model corpus.
- **Editing:** go to definition, references, hover, completion, signature
  help, rename, an outline, semantic highlighting, inlay hints for inferred
  types, and formatting.
- **Commands:** run and check from a code lens over each command, with the
  bundled Alloy 6.2.0; with the MiniSat with Unsat Core solver, holding
  checks and runs without instances show their unsat core in the editor.
- **Visualizer:** the Alloy app's views (graph, text, table and tree),
  solution and trace navigation with New, the evaluator, themes (`.thm`)
  with projection and Magic Layout, and export. The graph is drawn in your
  editor's colours, with panning, zooming and nodes you can drag.
- **Analyzer options and log:** the Alloy app's solver options as settings,
  and its output in a log panel; the metamodel and the sample models.
