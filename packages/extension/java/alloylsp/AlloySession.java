package alloylsp;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

import edu.mit.csail.sdg.alloy4.A4Reporter;
import edu.mit.csail.sdg.alloy4.Err;
import edu.mit.csail.sdg.alloy4.ErrorWarning;
import edu.mit.csail.sdg.alloy4.Pair;
import edu.mit.csail.sdg.alloy4.Pos;
import edu.mit.csail.sdg.ast.Command;
import edu.mit.csail.sdg.ast.Expr;
import edu.mit.csail.sdg.ast.Module;
import edu.mit.csail.sdg.parser.CompUtil;
import edu.mit.csail.sdg.translator.A4Options;
import edu.mit.csail.sdg.translator.A4Solution;
import edu.mit.csail.sdg.translator.A4SolutionWriter;
import edu.mit.csail.sdg.translator.TranslateAlloyToKodkod;
import kodkod.ast.Formula;
import kodkod.engine.PardinusSolver;
import kodkod.engine.Proof;
import kodkod.engine.Solution;
import kodkod.engine.Solver;
import kodkod.engine.config.ExtendedOptions;
import kodkod.engine.config.Options;
import kodkod.engine.satlab.SATFactory;
import kodkod.engine.ucore.RCEStrategy;
import kodkod.engine.ucore.SCEStrategy;
import kodkod.instance.PardinusBounds;

/**
 * One live Alloy session for the editor. It runs a command and keeps its
 * solution, so the visualizer can ask for the next one, the trace moves and
 * evaluations, as the Alloy app does; the jar's CLI can't, as it exits.
 *
 * Reads one JSON request per line on stdin and writes one JSON reply per line
 * on stdout: {"id", "ok": true, ...} or {"id", "ok": false, "error", "pos"?}.
 * Whatever the Analyzer itself prints goes to stderr.
 */
public final class AlloySession {

    private Module world;
    private Command command;
    private A4Solution solution;
    /** Set by New Init and New Fork, cleared by a run and New Config: Kodkod can't find a new trace after those (VizGUI's seg_iteration). */
    private boolean segmented;
    /** The run's core minimisation: 0 slow (RCE), 1 fast (SCE), 2 none, as A4Options has it. */
    private int coreMinimization = 2;

    public static void main(String[] args) throws IOException {
        PrintStream protocol = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(System.err);
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        AlloySession session = new AlloySession();
        for (String line; (line = in.readLine()) != null;) {
            if (line.isBlank()) continue;
            Map<String, Object> reply = new LinkedHashMap<>();
            try {
                Map<String, Object> request = Json.parseObject(line);
                reply.put("id", request.get("id"));
                Map<String, Object> result = session.handle(request);
                reply.put("ok", true);
                reply.putAll(result);
            } catch (Throwable t) {
                reply.put("ok", false);
                reply.put("error", t.getMessage() != null ? t.getMessage().trim() : t.toString());
                if (t instanceof Err && ((Err) t).pos != null && ((Err) t).pos != Pos.UNKNOWN) {
                    reply.put("pos", position(((Err) t).pos));
                }
            }
            protocol.println(Json.write(reply));
        }
    }

    private Map<String, Object> handle(Map<String, Object> request) throws Exception {
        String op = string(request, "op", null);
        if (op == null) throw new IllegalArgumentException("A request needs an op.");
        switch (op) {
            case "run": return run(request);
            case "next": return next(request);
            case "eval": return eval(request);
            case "metamodel": return metamodel(request);
            case "samples": return samples();
            case "models": return models(request);
            default: throw new IllegalArgumentException("Unknown op " + op + ".");
        }
    }

    /** Parses the file and runs its command with this index, as Execute does. */
    private Map<String, Object> run(Map<String, Object> request) throws Exception {
        String file = string(request, "file", null);
        if (file == null) throw new IllegalArgumentException("run needs a file.");
        int index = integer(request, "command", 0);
        // The Analyzer's warnings, kept to report and, when warnings aren't allowed, to stop on.
        List<ErrorWarning> warnings = new ArrayList<>();
        A4Reporter reporter = new A4Reporter() {
            @Override
            public void warning(ErrorWarning warning) {
                warnings.add(warning);
            }
        };
        world = CompUtil.parseEverything_fromFile(reporter, null, file);
        List<Command> commands = world.getAllCommands();
        if (index < 0 || index >= commands.size()) {
            throw new IllegalArgumentException("The model has " + commands.size() + " commands; there is none with index " + index + ".");
        }
        command = commands.get(index);
        A4Options options = new A4Options();
        options.originalFilename = file;
        String solver = string(request, "solver", null);
        if (solver != null) {
            options.solver = SATFactory.find(solver).orElseThrow(() -> new IllegalArgumentException("Unknown solver " + solver + "."));
        }
        options.skolemDepth = integer(request, "skolemDepth", options.skolemDepth);
        options.unrolls = integer(request, "unrolls", options.unrolls);
        options.symmetry = integer(request, "symmetry", options.symmetry);
        options.noOverflow = bool(request, "noOverflow", options.noOverflow);
        options.coreMinimization = integer(request, "coreMinimization", options.coreMinimization);
        coreMinimization = options.coreMinimization;
        options.coreGranularity = integer(request, "coreGranularity", options.coreGranularity);
        options.inferPartialInstance = bool(request, "inferPartialInstance", options.inferPartialInstance);
        options.decompose_mode = integer(request, "decompose", options.decompose_mode);
        options.recordKodkod = bool(request, "recordKodkod", options.recordKodkod);
        if (!bool(request, "allowWarnings", true) && !warnings.isEmpty()) {
            throw warnings.get(0);
        }
        long start = System.currentTimeMillis();
        solution = TranslateAlloyToKodkod.execute_commandFromBook(reporter, world.getAllReachableSigs(), command, options);
        segmented = false;
        Map<String, Object> result = describe();
        result.put("durationMs", System.currentTimeMillis() - start);
        List<Object> reported = new ArrayList<>();
        for (ErrorWarning warning : warnings) {
            Map<String, Object> w = new LinkedHashMap<>();
            w.put("message", warning.msg.trim());
            if (warning.pos != null && warning.pos != Pos.UNKNOWN) w.put("pos", position(warning.pos));
            reported.add(w);
        }
        result.put("warnings", reported);
        // Record the Kodkod input/output: the Java program the app links as "Predicate".
        if (options.recordKodkod) result.put("kodkod", solution.debugExtractKInput());
        return result;
    }

    /**
     * Another solution, as the visualizer's buttons ask for it: next (Show New
     * Solution), config, trace, init, or fork from a state. The codes passed to
     * A4Solution.fork are the ones VizGUI sends.
     */
    private Map<String, Object> next(Map<String, Object> request) throws Exception {
        if (solution == null) throw new IllegalStateException("Nothing has been run yet.");
        if (!solution.satisfiable()) {
            throw new IllegalStateException("This command is unsatisfiable, so there are no solutions to enumerate.");
        }
        if (!solution.isIncremental()) {
            throw new IllegalStateException("This solution was not generated by an incremental SAT solver; only MiniSat and SAT4J can enumerate.");
        }
        String mode = string(request, "mode", "next");
        int code;
        switch (mode) {
            case "next": code = -3; break;
            case "config": code = -1; break;
            case "trace": code = -2; break;
            case "init": code = 0; break;
            case "fork": code = integer(request, "state", 0) + 1; break;
            default: throw new IllegalArgumentException("Unknown mode " + mode + ".");
        }
        if (segmented && (code == -2 || code == -3)) {
            throw new IllegalStateException("A new trace can't follow New Init or New Fork; use New Config first.");
        }
        solution = solution.fork(code);
        if (code == -1) segmented = false;
        else if (code >= 0) segmented = true;
        return describe();
    }

    /** The value of an expression in a state of the current solution, as the Evaluator shows it. */
    private Map<String, Object> eval(Map<String, Object> request) throws Exception {
        if (solution == null || !solution.satisfiable()) throw new IllegalStateException("There is no instance to evaluate in.");
        String text = string(request, "expr", "");
        int state = integer(request, "state", 0);
        Expr expr = CompUtil.parseOneExpression_fromString(world, text);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("value", String.valueOf(solution.eval(expr, state)));
        return result;
    }

    /** The model's sigs and fields as an instance XML, which Show Metamodel draws: of `file` if given, else of the model last run. */
    private Map<String, Object> metamodel(Map<String, Object> request) throws Exception {
        String file = string(request, "file", null);
        if (file != null) world = CompUtil.parseEverything_fromFile(A4Reporter.NOP, null, file);
        if (world == null) throw new IllegalStateException("Nothing has been run yet.");
        StringWriter xml = new StringWriter();
        try (PrintWriter out = new PrintWriter(xml)) {
            A4SolutionWriter.writeMetamodel(world.getAllReachableSigs(), world.path(), out);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("xml", xml.toString());
        return result;
    }

    /** The sample themes inside the Alloy jar, as the app's Load Sample Theme offers them. */
    private Map<String, Object> samples() throws Exception {
        List<Object> themes = new ArrayList<>();
        File jar = new File(CompUtil.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        try (JarFile archive = new JarFile(jar)) {
            for (JarEntry entry : java.util.Collections.list(archive.entries())) {
                if (!entry.getName().startsWith("models/") || !entry.getName().endsWith(".thm")) continue;
                Map<String, Object> theme = new LinkedHashMap<>();
                theme.put("path", entry.getName());
                theme.put("text", new String(archive.getInputStream(entry).readAllBytes(), StandardCharsets.UTF_8));
                themes.add(theme);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("themes", themes);
        return result;
    }

    /** Copies the sample models inside the Alloy jar under `target`, as the app's Open Sample Models offers them. */
    private Map<String, Object> models(Map<String, Object> request) throws Exception {
        String target = string(request, "target", null);
        if (target == null) throw new IllegalArgumentException("models needs a target folder.");
        File root = new File(target).getCanonicalFile();
        int count = 0;
        File jar = new File(CompUtil.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        try (JarFile archive = new JarFile(jar)) {
            for (JarEntry entry : java.util.Collections.list(archive.entries())) {
                if (!entry.getName().startsWith("models/") || entry.isDirectory()) continue;
                File out = new File(root, entry.getName().substring("models/".length())).getCanonicalFile();
                if (!out.toPath().startsWith(root.toPath())) continue;
                out.getParentFile().mkdirs();
                Files.write(out.toPath(), archive.getInputStream(entry).readAllBytes());
                count++;
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("folder", root.getPath());
        result.put("count", count);
        return result;
    }

    private Map<String, Object> describe() throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("command", command.label);
        result.put("kind", command.check ? "check" : "run");
        result.put("satisfiable", solution.satisfiable());
        result.put("incremental", solution.isIncremental());
        result.put("newTraceAllowed", !segmented);
        if (solution.satisfiable()) {
            result.put("traceLength", solution.getTraceLength());
            result.put("loopState", solution.getLoopState());
            File xml = File.createTempFile("alloy-instance-", ".xml");
            try {
                solution.writeXML(xml.getPath(), world.getAllFunc());
                result.put("xml", Files.readString(xml.toPath(), StandardCharsets.UTF_8));
            } finally {
                xml.delete();
            }
        } else {
            Pair<Set<Pos>, Set<Pos>> core = solution.highLevelCore();
            Set<Pos> found = new java.util.LinkedHashSet<>(core.a);
            found.addAll(core.b);
            if (found.isEmpty()) found = recomputedCore();
            List<Object> positions = new ArrayList<>();
            for (Pos pos : found) positions.add(position(pos));
            result.put("core", positions);
        }
        return result;
    }

    /**
     * The unsat core, solved for again. A4Solution's own core is always empty
     * in 6.2.0: its Kodkod solution comes from the incremental enumerator, and
     * MiniSat's prover is freed before its trace can be read (see CoreProver).
     * So the same formulas and bounds are solved once more with a CoreProver,
     * the proof minimised as the options say (RCE slow, SCE fast), and the core
     * mapped back to Alloy positions through A4Solution's k2pos, as it does.
     * Empty unless the solver is a prover.
     */
    @SuppressWarnings("unchecked")
    private Set<Pos> recomputedCore() {
        Set<Pos> positions = new java.util.LinkedHashSet<>();
        CoreProver prover = null;
        try {
            PardinusSolver solver = (PardinusSolver) field("solver");
            ExtendedOptions options = solver.options();
            if (!options.solver().prover()) return positions;
            prover = new CoreProver(options.solver());
            Formula formula = Formula.and((List<Formula>) field("formulas"));
            PardinusBounds bounds = (PardinusBounds) field("bounds");
            Map<Formula, Object> k2pos = (Map<Formula, Object>) field("k2pos");
            Solution plain;
            if (options.temporal()) {
                ExtendedOptions again = new ExtendedOptions(options);
                again.setSolver(prover);
                plain = new PardinusSolver(again).solve(formula, bounds);
            } else {
                Options again = new Options();
                again.setSolver(prover);
                again.setLogTranslation(2);
                again.setCoreGranularity(options.coreGranularity());
                again.setSkolemDepth(options.skolemDepth());
                again.setSymmetryBreaking(options.symmetryBreaking());
                again.setBitwidth(options.bitwidth());
                again.setNoOverflow(options.noOverflow());
                plain = new Solver(again).solve(formula, bounds);
            }
            Proof proof = plain.proof();
            if (proof == null) return positions;
            if (coreMinimization == 0) proof.minimize(new RCEStrategy(proof.log()));
            else if (coreMinimization == 1) proof.minimize(new SCEStrategy(proof.log()));
            for (Map.Entry<Formula, kodkod.ast.Node> entry : proof.highLevelCore().entrySet()) {
                addPosition(positions, k2pos.get(entry.getKey()));
                if (entry.getValue() instanceof Formula) addPosition(positions, k2pos.get((Formula) entry.getValue()));
            }
        } catch (Exception | LinkageError e) {
            System.err.println("The unsat core could not be computed: " + e);
        } finally {
            if (prover != null) prover.release();
        }
        return positions;
    }

    private static void addPosition(Set<Pos> positions, Object origin) {
        Pos pos = origin instanceof Pos ? (Pos) origin : origin instanceof Expr ? ((Expr) origin).span() : null;
        if (pos != null && pos != Pos.UNKNOWN) positions.add(pos);
    }

    private Object field(String name) throws ReflectiveOperationException {
        Field field = A4Solution.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(solution);
    }

    private static Map<String, Object> position(Pos pos) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("file", pos.filename);
        p.put("line", pos.y);
        p.put("column", pos.x);
        p.put("endLine", pos.y2);
        p.put("endColumn", pos.x2);
        return p;
    }

    private static String string(Map<String, Object> request, String key, String fallback) {
        Object value = request.get(key);
        return value instanceof String ? (String) value : fallback;
    }

    private static int integer(Map<String, Object> request, String key, int fallback) {
        Object value = request.get(key);
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    private static boolean bool(Map<String, Object> request, String key, boolean fallback) {
        Object value = request.get(key);
        return value instanceof Boolean ? (Boolean) value : fallback;
    }
}
