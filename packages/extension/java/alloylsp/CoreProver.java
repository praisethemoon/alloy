package alloylsp;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import kodkod.engine.satlab.NativeSolver;
import kodkod.engine.satlab.ReductionStrategy;
import kodkod.engine.satlab.ResolutionTrace;
import kodkod.engine.satlab.SATFactory;
import kodkod.engine.satlab.SATProver;
import kodkod.engine.satlab.SATSolver;

/**
 * Makes the 6.2.0 jar's MiniSat prover give unsat cores.
 *
 * MiniSatProver.proof() reads the resolution trace from the native solver,
 * frees the solver, and only then formats the trace, which needs the solver's
 * variable count: so every core fails with "this native solver is already
 * freed". Kodkod also frees solvers when a solve ends, before the core is read.
 *
 * The solvers this factory makes defer free() until {@link #release()}, and
 * the first time a proof is needed they build the trace in the right order
 * (read, format, then keep it in the prover's own cache), so later proof() and
 * reduce() calls, including core minimisation, find it there. This leans on
 * MiniSatProver's internals; anything unexpected leaves the prover as it was.
 */
final class CoreProver extends SATFactory {

    private static final long serialVersionUID = 1L;

    private final SATFactory delegate;
    private final transient List<SATSolver> made = new ArrayList<>();

    CoreProver(SATFactory delegate) {
        this.delegate = delegate;
    }

    @Override
    public String id() {
        return delegate.id();
    }

    @Override
    public String type() {
        return delegate.type();
    }

    @Override
    public boolean prover() {
        return true;
    }

    @Override
    public boolean incremental() {
        return delegate.incremental();
    }

    @Override
    public boolean isPresent() {
        return delegate.isPresent();
    }

    @Override
    protected SATSolver createSolver() {
        SATSolver solver = delegate.instance();
        made.add(solver);
        return solver instanceof SATProver ? new Kept((SATProver) solver) : solver;
    }

    /** Frees the native solvers this factory made, once their cores have been read. */
    void release() {
        for (SATSolver solver : made) solver.free();
        made.clear();
    }

    /** A prover whose free() waits for release() and whose trace is built before it is freed. */
    private static final class Kept implements SATProver {

        private final SATProver solver;
        private boolean traced;

        Kept(SATProver solver) {
            this.solver = solver;
        }

        @Override public int numberOfVariables() { return solver.numberOfVariables(); }
        @Override public int numberOfClauses() { return solver.numberOfClauses(); }
        @Override public void addVariables(int count) { solver.addVariables(count); }
        @Override public boolean addClause(int[] literals) { return solver.addClause(literals); }
        @Override public boolean solve() { return solver.solve(); }
        @Override public boolean valueOf(int variable) { return solver.valueOf(variable); }

        @Override
        public void free() {
            // Freed by CoreProver.release(), after the core is read.
        }

        @Override
        public ResolutionTrace proof() {
            trace();
            return solver.proof();
        }

        @Override
        public void reduce(ReductionStrategy strategy) {
            trace();
            solver.reduce(strategy);
        }

        /** Reads and formats the trace while the native solver lives, and leaves it in MiniSatProver's cache. */
        private void trace() {
            if (traced) return;
            traced = true;
            try {
                Class<?> type = solver.getClass();
                Field cache = type.getDeclaredField("proof");
                cache.setAccessible(true);
                if (cache.get(solver) != null) return;
                Method read = type.getDeclaredMethod("trace", long.class, boolean.class);
                read.setAccessible(true);
                int[][] raw = (int[][]) read.invoke(solver, ((NativeSolver) solver).peer(), true);
                Method format = type.getDeclaredMethod(raw[raw.length - 1].length == 0 ? "formatTrivial" : "format", int[][].class);
                format.setAccessible(true);
                int[][] formatted = (int[][]) format.invoke(solver, (Object) raw);
                Constructor<?> lazy = Class.forName(type.getPackageName() + ".LazyTrace").getDeclaredConstructor(int[][].class, int.class);
                lazy.setAccessible(true);
                cache.set(solver, lazy.newInstance(formatted, solver.numberOfClauses()));
            } catch (ReflectiveOperationException | ClassCastException | IllegalStateException e) {
                System.err.println("Could not prepare the unsat core trace: " + e);
            }
        }
    }
}
