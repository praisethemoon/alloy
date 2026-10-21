import { allAtoms, type AlloyRelation, type AlloySig, type AlloyState } from './instance.js';
import { themeName } from './dot.js';

// Projection, as the app's AlloyProjection/StaticProjector does it: for each
// projected sig one of its atoms is picked; that sig's atoms leave the graph,
// every relation keeps only the tuples through the picked atom, minus that
// column, and relations left with one column label their atoms.

/** The sigs that can be projected over: those with atoms, not builtins or subsets. */
export function projectableSigs(state: AlloyState): AlloySig[] {
    return state.sigs.filter(s => !s.builtin && s.subsetOf.length === 0 && allAtoms(state, s).length > 0);
}

/** The atoms of a projected sig, by its theme name, to pick from. */
export function projectionAtoms(state: AlloyState, type: string): string[] {
    const sig = state.sigs.find(s => themeName(s) === type);
    return sig ? allAtoms(state, sig) : [];
}

/** Whether column `type` of a relation is the projected sig or one extending it. */
function isProjected(state: AlloyState, typeId: string, projected: AlloySig): boolean {
    for (let s = state.sigs.find(x => x.id === typeId); s; s = state.sigs.find(x => x.id === s!.parentId && x.id !== s!.id)) {
        if (s.id === projected.id) return true;
    }
    return false;
}

/**
 * The state as seen through a projection: `picks` maps each projected sig
 * (theme name) to the atom picked. Sigs without atoms are left out of the
 * projection.
 */
export function projectState(state: AlloyState, picks: Record<string, string>): AlloyState {
    let current = state;
    for (const [type, atom] of Object.entries(picks)) {
        const sig = current.sigs.find(s => themeName(s) === type);
        if (!sig || !atom) continue;
        const removed = new Set(allAtoms(current, sig));
        const project = (relation: AlloyRelation): AlloyRelation => {
            const columns = relation.types.map(id => isProjected(current, id, sig));
            if (!columns.some(Boolean)) return relation;
            return {
                ...relation,
                types: relation.types.filter((_, i) => !columns[i]),
                tuples: relation.tuples
                    .filter(t => t.every((a, i) => !columns[i] || a === atom))
                    .map(t => t.filter((_, i) => !columns[i]))
            };
        };
        const fields = current.fields.map(project);
        const skolems = current.skolems.map(project);
        // Fields left with one column become sets labelling their atoms, as the app shows them.
        const asSets: AlloySig[] = fields.filter(f => f.types.length === 1).map(f => ({
            id: `projected:${f.id}`, label: f.label, subsetOf: [f.types[0]], builtin: false, abstract: false,
            var: f.var, private: f.private, meta: f.meta, atoms: f.tuples.map(t => t[0])
        }));
        current = {
            sigs: [
                ...current.sigs.map(s => ({ ...s, atoms: s.atoms.filter(a => !removed.has(a)) })),
                ...asSets
            ],
            fields: fields.filter(f => f.types.length >= 2),
            skolems: skolems.filter(s => s.types.length >= 1)
        };
    }
    return current;
}
