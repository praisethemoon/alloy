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
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import edu.mit.csail.sdg.alloy4.A4Reporter;
import edu.mit.csail.sdg.alloy4.Err;
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
import kodkod.engine.satlab.SATFactory;

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
            case "metamodel": return metamodel();
            default: throw new IllegalArgumentException("Unknown op " + op + ".");
        }
    }

    /** Parses the file and runs its command with this index, as Execute does. */
    private Map<String, Object> run(Map<String, Object> request) throws Exception {
        String file = string(request, "file", null);
        if (file == null) throw new IllegalArgumentException("run needs a file.");
        int index = integer(request, "command", 0);
        world = CompUtil.parseEverything_fromFile(A4Reporter.NOP, null, file);
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
        options.coreGranularity = integer(request, "coreGranularity", options.coreGranularity);
        options.inferPartialInstance = bool(request, "inferPartialInstance", options.inferPartialInstance);
        options.decompose_mode = integer(request, "decompose", options.decompose_mode);
        options.recordKodkod = bool(request, "recordKodkod", options.recordKodkod);
        long start = System.currentTimeMillis();
        solution = TranslateAlloyToKodkod.execute_commandFromBook(A4Reporter.NOP, world.getAllReachableSigs(), command, options);
        segmented = false;
        Map<String, Object> result = describe();
        result.put("durationMs", System.currentTimeMillis() - start);
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

    /** The model's sigs and fields as an instance XML, which Show Metamodel draws. */
    private Map<String, Object> metamodel() throws Exception {
        if (world == null) throw new IllegalStateException("Nothing has been run yet.");
        StringWriter xml = new StringWriter();
        try (PrintWriter out = new PrintWriter(xml)) {
            A4SolutionWriter.writeMetamodel(world.getAllReachableSigs(), world.path(), out);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("xml", xml.toString());
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
            List<Object> positions = new ArrayList<>();
            for (Pos pos : core.a) positions.add(position(pos));
            for (Pos pos : core.b) positions.add(position(pos));
            result.put("core", positions);
        }
        return result;
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
