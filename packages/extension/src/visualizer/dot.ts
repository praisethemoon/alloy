import { BUILTIN_SIGS, shortLabel, sigOfAtom, type AlloyRelation, type AlloySig, type AlloyState } from './instance.js';
import {
    BUILTIN_EDGE, BUILTIN_NODE, dotColor, dotShape, emptyTheme, magicEdgeColor, relationKey, setKey,
    type EdgeSettings, type NodeSettings, type Theme
} from './theme.js';

// Draws one state as the Alloy app does (StaticGraphMaker), under a theme:
// every setting is looked up on the sig, then the sigs it extends, then the
// theme's default node or edge, then the app's built-in default.

/** The Classic palette's colour for DotColor.YELLOW, the default node colour. */
export const NODE_COLOR = 'gold';
/** StaticGraphMaker.colorsClassic: the colours relations take in turn. */
export const EDGE_COLORS = ['#e41a1c', '#a65628', '#ff7f00', '#4daf4a', '#377eb8', '#984ea3'];

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function toSuperscript(digits: string): string {
    return digits.replace(/[0-9]/g, d => SUPERSCRIPT_DIGITS[Number(d)]);
}

/** A sig's name as themes write it: `Person`, `Int`, `timeOrder/Ord`. */
export function themeName(sig: AlloySig): string {
    return shortLabel(sig.label);
}

function parentOf(state: AlloyState, sig: AlloySig): AlloySig | undefined {
    return sig.parentId !== undefined ? state.sigs.find(s => s.id === sig.parentId && s.id !== sig.id) : undefined;
}

/** A node setting of a sig: its own, then its ancestors', then the theme default, then the built-in one. */
export function nodeSetting<K extends keyof NodeSettings>(state: AlloyState, theme: Theme, sig: AlloySig | undefined, key: K): Required<NodeSettings>[K] {
    for (let s = sig; s; s = parentOf(state, s)) {
        const own = theme.types[themeName(s)]?.[key];
        if (own !== undefined) return own as Required<NodeSettings>[K];
        if (s.label === 'Int' || s.label === 'seq/Int') {
            // The app hides unconnected integers unless told otherwise.
            if (key === 'hideUnconnected') return true as Required<NodeSettings>[K];
        }
    }
    return (theme.defaultNode[key] ?? BUILTIN_NODE[key]) as Required<NodeSettings>[K];
}

/** A set's setting (a subset sig or a one-column skolem): its own, then the theme default. */
function setSetting<K extends keyof NodeSettings>(theme: Theme, name: string, type: string, key: K): Required<NodeSettings>[K] {
    return (theme.sets[setKey(name, type)]?.[key] ?? theme.defaultNode[key] ?? BUILTIN_NODE[key]) as Required<NodeSettings>[K];
}

/** The theme names of a relation's columns. */
export function columnNames(state: AlloyState, relation: AlloyRelation): string[] {
    return relation.types.map(id => {
        const sig = state.sigs.find(s => s.id === id);
        return sig ? themeName(sig) : id;
    });
}

/** An edge setting of a relation: its own, then the theme default, then the built-in one. */
export function edgeSetting<K extends keyof EdgeSettings>(state: AlloyState, theme: Theme, relation: AlloyRelation, key: K): Required<EdgeSettings>[K] {
    const own = theme.relations[relationKey(relation.label, columnNames(state, relation))]?.[key];
    return (own ?? theme.defaultEdge[key] ?? BUILTIN_EDGE[key]) as Required<EdgeSettings>[K];
}

/**
 * How the app names an atom: `Node$1` becomes `Node1`, the only atom of its
 * sig just `Alice`, a sig's theme label replaces its name, and numbering can
 * be turned off. `superscript` writes the number as the table view does.
 */
export function atomName(state: AlloyState, atom: string, superscript = false, theme: Theme = emptyTheme()): string {
    if (theme.useOriginalAtomNames) return atom;
    const dollar = atom.lastIndexOf('$');
    if (dollar < 0) return atom;
    const sig = sigOfAtom(state, atom);
    const label = sig ? nodeSetting(state, theme, sig, 'label') : '';
    const base = label || shortLabel(atom.slice(0, dollar));
    if (sig && (sig.atoms.length === 1 || !nodeSetting(state, theme, sig, 'numberAtoms'))) return base;
    const index = atom.slice(dollar + 1);
    return base + (superscript ? toSuperscript(index) : index);
}

function quote(text: string): string {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function dotStyle(style: Required<NodeSettings>['style'], dashed: boolean): string {
    if (dashed && style === 'Solid') return 'dashed';
    return style.toLowerCase();
}

/** Whether a relation is drawn at all under the theme's hiding rules. */
function shown(relation: AlloyRelation, theme: Theme): boolean {
    if (relation.private && theme.hidePrivate) return false;
    if (relation.meta && theme.hideMeta) return false;
    if (relation.skolem && theme.hideSkolem) return false;
    return true;
}

/** The relations drawn as arcs or attributes: fields and skolems with two or more columns. */
export function arcRelations(state: AlloyState, theme: Theme = emptyTheme()): AlloyRelation[] {
    return [...state.fields, ...state.skolems].filter(r => r.types.length >= 2 && shown(r, theme));
}

/** Dot for one state under a theme; with no theme, as the app draws it with none loaded. */
export function instanceToDot(state: AlloyState, theme: Theme = emptyTheme()): string {
    const name = (atom: string) => atomName(state, atom, false, theme);
    const sigOf = new Map<string, AlloySig>();
    for (const sig of state.sigs) {
        if (sig.subsetOf.length === 0) for (const atom of sig.atoms) sigOf.set(atom, sig);
    }
    const hiddenSig = (sig: AlloySig | undefined) => !!sig && (
        !nodeSetting(state, theme, sig, 'visible')
        || (sig.private && theme.hidePrivate) || (sig.meta && theme.hideMeta)
        || sig.label === 'univ' || sig.label === 'none');
    const visibleAtom = (atom: string) => !hiddenSig(sigOf.get(atom));

    const lines = new Map<string, string[]>();
    const ensure = (atom: string) => {
        if (!lines.has(atom)) lines.set(atom, [name(atom)]);
        return lines.get(atom)!;
    };
    for (const [atom, sig] of sigOf) {
        if (!BUILTIN_SIGS.has(sig.label) && visibleAtom(atom)) ensure(atom);
    }
    // Sets and one-column skolems become label lines on their members.
    for (const sig of state.sigs) {
        if (sig.subsetOf.length === 0 || hiddenSig(sig)) continue;
        const parent = state.sigs.find(s => s.id === sig.subsetOf[0]);
        const type = parent ? themeName(parent) : '';
        if (!setSetting(theme, themeName(sig), type, 'visible') || !setSetting(theme, themeName(sig), type, 'showAsLabel')) continue;
        for (const atom of sig.atoms) if (visibleAtom(atom)) ensure(atom).push(`(${themeName(sig)})`);
    }
    for (const skolem of state.skolems) {
        if (skolem.types.length !== 1 || !shown(skolem, theme)) continue;
        const type = columnNames(state, skolem)[0];
        if (!setSetting(theme, skolem.label, type, 'visible') || !setSetting(theme, skolem.label, type, 'showAsLabel')) continue;
        for (const [atom] of skolem.tuples) if (visibleAtom(atom)) ensure(atom).push(skolem.label);
    }

    const edges: string[] = [];
    const connected = new Set<string>();
    arcRelations(state, theme).forEach((relation, index) => {
        const label = edgeSetting(state, theme, relation, 'label') || relation.label;
        const asAttribute = edgeSetting(state, theme, relation, 'attribute');
        const visible = edgeSetting(state, theme, relation, 'visible');
        const tuples = relation.tuples.filter(t => t.every(visibleAtom));
        if (asAttribute) {
            // An attribute only needs its atom shown; it may name hidden ones, as hotel.thm does with keys.
            for (const tuple of relation.tuples.filter(t => visibleAtom(t[0]))) {
                ensure(tuple[0]).push(`${label}: ${tuple.slice(1).map(name).join('->')}`);
            }
        }
        if (!visible) return;
        const color = edgeSetting(state, theme, relation, 'color');
        const colour = color === 'Magic' ? magicEdgeColor(theme.edgePalette, index) : dotColor(color, theme.edgePalette);
        const style = dotStyle(edgeSetting(state, theme, relation, 'style'), relation.var);
        const weight = edgeSetting(state, theme, relation, 'weight');
        const merge = edgeSetting(state, theme, relation, 'merge');
        const constraint = edgeSetting(state, theme, relation, 'constraint');
        const back = edgeSetting(state, theme, relation, 'layoutBack');
        const arcs: Array<{ from: string, to: string, label: string, both: boolean }> = [];
        const arcIndex = new Map<string, number>();
        for (const tuple of tuples) {
            const from = tuple[0];
            const to = tuple[tuple.length - 1];
            const middle = tuple.slice(1, -1).map(name);
            const text = middle.length > 0 ? `${label}[${middle.join(', ')}]` : label;
            const reverse = merge && from !== to ? arcIndex.get(`${to}\u0000${from}\u0000${text}`) : undefined;
            if (reverse !== undefined) {
                arcs[reverse].both = true;
            } else {
                arcIndex.set(`${from}\u0000${to}\u0000${text}`, arcs.length);
                arcs.push({ from, to, label: text, both: false });
            }
            connected.add(from).add(to);
            ensure(from);
            ensure(to);
        }
        for (const edge of arcs) {
            const attrs = [`label=${quote(edge.label)}`, `color=${quote(colour)}`, `fontcolor=${quote(colour)}`, `style=${style}`];
            if (weight) attrs.push(`weight=${weight}`);
            if (!constraint) attrs.push('constraint=false');
            if (edge.both) attrs.push('dir=both');
            // Laid out backwards: the arc runs to → from in the layout, with the head drawn at `to`.
            edges.push(back
                ? `  ${quote(edge.to)} -> ${quote(edge.from)} [${[...attrs, edge.both ? '' : 'dir=back'].filter(Boolean).join(', ')}];`
                : `  ${quote(edge.from)} -> ${quote(edge.to)} [${attrs.join(', ')}];`);
        }
    });

    const nodes: string[] = [];
    for (const [atom, label] of lines) {
        const sig = sigOf.get(atom);
        if (sig && nodeSetting(state, theme, sig, 'hideUnconnected') && !connected.has(atom)) continue;
        if (!sig && !connected.has(atom)) continue;
        const color = sig ? nodeSetting(state, theme, sig, 'color') : 'Yellow';
        const fill = dotColor(color === 'Magic' ? 'Yellow' : color, theme.nodePalette);
        const shape = dotShape(sig ? nodeSetting(state, theme, sig, 'shape') : 'Box');
        const style = sig ? dotStyle(nodeSetting(state, theme, sig, 'style'), sig.var) : 'solid';
        nodes.push(`  ${quote(atom)} [label=${quote(label.join('\n'))}, shape=${shape}, fillcolor=${quote(fill)}, style=${quote(`filled,${style}`)}];`);
    }

    return [
        'digraph instance {',
        '  graph [rankdir=TB, bgcolor=transparent, nodesep=0.4, ranksep=0.5];',
        `  node [color=black, fontname="Helvetica", fontsize=${theme.fontSize}];`,
        `  edge [fontname="Helvetica", fontsize=${Math.max(theme.fontSize - 2, 6)}, arrowsize=0.7];`,
        ...nodes,
        ...edges,
        '}'
    ].join('\n');
}
