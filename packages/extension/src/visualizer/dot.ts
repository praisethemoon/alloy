import { BUILTIN_SIGS, shortLabel, sigOfAtom, type AlloyRelation, type AlloyState } from './instance.js';

// The Alloy app's default theme (VizState.resetTheme, StaticGraphMaker, DotColor):
// atoms are boxes filled with the Classic palette's yellow, set memberships are
// extra label lines, each relation is drawn as arcs in the next Classic edge
// colour, var parts are dashed, and opposing arcs of one relation are merged.

/** The Classic palette's colour for DotColor.YELLOW. */
export const NODE_COLOR = 'gold';
/** StaticGraphMaker.colorsClassic: the colours relations take in turn. */
export const EDGE_COLORS = ['#e41a1c', '#a65628', '#ff7f00', '#4daf4a', '#377eb8', '#984ea3'];

/**
 * How the app names an atom when original names are off: `Node$1` becomes
 * `Node1`, and the atom of a sig with only that one atom just `Alice`.
 * `superscript` writes the number as the table view does (`Node¹`).
 */
export function atomName(state: AlloyState, atom: string, superscript = false): string {
    const dollar = atom.lastIndexOf('$');
    if (dollar < 0) return atom;
    const base = shortLabel(atom.slice(0, dollar));
    const index = atom.slice(dollar + 1);
    const sig = sigOfAtom(state, atom);
    if (sig && sig.atoms.length === 1) return base;
    return base + (superscript ? toSuperscript(index) : index);
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function toSuperscript(digits: string): string {
    return digits.replace(/[0-9]/g, d => SUPERSCRIPT_DIGITS[Number(d)]);
}

function quote(text: string): string {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** The relations drawn as arcs: fields and skolems with two or more columns. */
export function arcRelations(state: AlloyState): AlloyRelation[] {
    return [...state.fields, ...state.skolems].filter(r => r.types.length >= 2);
}

/** Dot for one state, as the app draws it with no theme loaded. */
export function instanceToDot(state: AlloyState): string {
    const labels = new Map<string, string[]>();
    const dashed = new Set<string>();
    const hiddenUnlessConnected = new Set<string>();
    for (const sig of state.sigs) {
        if (sig.subsetOf.length > 0) continue;
        for (const atom of sig.atoms) {
            if (BUILTIN_SIGS.has(sig.label)) {
                hiddenUnlessConnected.add(atom);
            }
            labels.set(atom, [atomName(state, atom)]);
            if (sig.var) dashed.add(atom);
        }
    }
    // Sets and one-column skolems become label lines on their members.
    const setLines: Array<[string, string, boolean]> = [];
    for (const sig of state.sigs) {
        if (sig.subsetOf.length === 0) continue;
        for (const atom of sig.atoms) setLines.push([atom, `(${shortLabel(sig.label)})`, sig.var]);
    }
    for (const skolem of state.skolems) {
        if (skolem.types.length !== 1) continue;
        for (const [atom] of skolem.tuples) setLines.push([atom, skolem.label, skolem.var]);
    }
    for (const [atom, line] of setLines) {
        if (!labels.has(atom)) labels.set(atom, [atomName(state, atom)]);
        labels.get(atom)!.push(line);
    }

    const edges: string[] = [];
    const connected = new Set<string>();
    arcRelations(state).forEach((relation, index) => {
        const color = EDGE_COLORS[index % EDGE_COLORS.length];
        const style = relation.var ? 'dashed' : 'solid';
        const seen = new Map<string, { from: string, to: string, label: string, both: boolean }>();
        for (const tuple of relation.tuples) {
            const from = tuple[0];
            const to = tuple[tuple.length - 1];
            const middle = tuple.slice(1, -1).map(a => atomName(state, a));
            const label = middle.length > 0 ? `${relation.label}[${middle.join(', ')}]` : relation.label;
            const reverse = seen.get(`${to}\u0000${from}\u0000${label}`);
            if (reverse && from !== to) {
                reverse.both = true;
            } else {
                seen.set(`${from}\u0000${to}\u0000${label}`, { from, to, label, both: false });
            }
            connected.add(from).add(to);
            for (const atom of tuple) if (!labels.has(atom)) labels.set(atom, [atomName(state, atom)]);
        }
        for (const edge of seen.values()) {
            edges.push(`  ${quote(edge.from)} -> ${quote(edge.to)} [label=${quote(edge.label)}, color=${quote(color)}, fontcolor=${quote(color)}, style=${style}${edge.both ? ', dir=both' : ''}];`);
        }
    });

    const nodes: string[] = [];
    for (const [atom, lines] of labels) {
        if (hiddenUnlessConnected.has(atom) && !connected.has(atom)) continue;
        const style = dashed.has(atom) ? 'filled,dashed' : 'filled';
        nodes.push(`  ${quote(atom)} [label=${quote(lines.join('\n'))}, style=${quote(style)}];`);
    }

    return [
        'digraph instance {',
        '  graph [rankdir=TB, bgcolor=transparent, nodesep=0.4, ranksep=0.5];',
        `  node [shape=box, fillcolor=${quote(NODE_COLOR)}, color=black, fontname="Helvetica", fontsize=12];`,
        '  edge [fontname="Helvetica", fontsize=10, arrowsize=0.7];',
        ...nodes,
        ...edges,
        '}'
    ].join('\n');
}
