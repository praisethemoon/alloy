import { atomName } from './dot.js';
import { allAtoms, BUILTIN_SIGS, shortLabel, type AlloySig, type AlloyState } from './instance.js';

/** The sigs a model declares, in the XML's order: no builtins. */
function userSigs(state: AlloyState): AlloySig[] {
    return state.sigs.filter(s => !s.builtin && !BUILTIN_SIGS.has(s.label));
}

function set(tuples: string[][]): string {
    return `{${tuples.map(t => t.join('->')).join(', ')}}`;
}

/** The Txt view: one line per sig, field and skolem, as the Analyzer prints an instance. */
export function instanceToText(state: AlloyState): string {
    const lines: string[] = [];
    const univ = new Set<string>();
    for (const sig of state.sigs) for (const atom of sig.atoms) univ.add(atom);
    lines.push(`univ=${set([...univ].map(a => [a]))}`);
    for (const sig of userSigs(state)) {
        lines.push(`${sig.label}=${set(allAtoms(state, sig).map(a => [a]))}`);
    }
    for (const field of state.fields) {
        const owner = state.sigs.find(s => s.id === field.parentId);
        lines.push(`${owner ? owner.label + '<:' : ''}${field.label}=${set(field.tuples)}`);
    }
    for (const skolem of state.skolems) {
        lines.push(`skolem ${skolem.label}=${set(skolem.tuples)}`);
    }
    return lines.join('\n');
}

/** One table of the Table view: a header row and data rows. */
export interface InstanceTable {
    title: string;
    columns: string[];
    rows: string[][];
}

/**
 * The Table view: per sig a table of its atoms and the values of the fields
 * it declares (what follows the atom in each tuple), then per skolem one.
 */
export function instanceToTables(state: AlloyState): InstanceTable[] {
    const name = (atom: string) => atomName(state, atom, true);
    const tables: InstanceTable[] = [];
    for (const sig of userSigs(state)) {
        const atoms = allAtoms(state, sig);
        if (atoms.length === 0) continue;
        const fields = state.fields.filter(f => f.parentId === sig.id);
        tables.push({
            title: shortLabel(sig.label),
            columns: [shortLabel(sig.label), ...fields.map(f => f.label)],
            rows: atoms.map(atom => [
                name(atom),
                ...fields.map(f => f.tuples.filter(t => t[0] === atom).map(t => t.slice(1).map(name).join('->')).join(', '))
            ])
        });
    }
    for (const skolem of state.skolems) {
        tables.push({
            title: skolem.label,
            columns: skolem.types.map((_, i) => `${skolem.label}${skolem.types.length > 1 ? ` [${i + 1}]` : ''}`),
            rows: skolem.tuples.map(t => t.map(name))
        });
    }
    return tables;
}

/** A node of the Tree view. */
export interface InstanceTreeNode {
    id: string;
    label: string;
    children?: InstanceTreeNode[];
}

/** The Tree view: sigs, their atoms, each atom's fields and their values; then skolems. */
export function instanceToTree(state: AlloyState): InstanceTreeNode[] {
    const name = (atom: string) => atomName(state, atom);
    const nodes: InstanceTreeNode[] = userSigs(state).map(sig => ({
        id: `sig:${sig.id}`,
        label: shortLabel(sig.label),
        children: allAtoms(state, sig).map(atom => ({
            id: `sig:${sig.id}:${atom}`,
            label: name(atom),
            children: state.fields
                .filter(f => f.parentId === sig.id)
                .map(f => ({
                    id: `sig:${sig.id}:${atom}:${f.id}`,
                    label: f.label,
                    children: f.tuples.filter(t => t[0] === atom).map((t, i) => ({
                        id: `sig:${sig.id}:${atom}:${f.id}:${i}`,
                        label: t.slice(1).map(name).join(' -> ')
                    }))
                }))
        }))
    }));
    for (const skolem of state.skolems) {
        nodes.push({
            id: `skolem:${skolem.id}`,
            label: skolem.label,
            children: skolem.tuples.map((t, i) => ({ id: `skolem:${skolem.id}:${i}`, label: t.map(name).join(' -> ') }))
        });
    }
    return nodes;
}
