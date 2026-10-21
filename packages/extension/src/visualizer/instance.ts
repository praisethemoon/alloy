import { parseXml, type XmlElement } from './xml.js';

/** A sig of one state, as the Analyzer's XML gives it. */
export interface AlloySig {
    id: string;
    /** E.g. `this/Node`, `Int`, `univ`. */
    label: string;
    /** The sig it extends; undefined for univ and for subset sigs. */
    parentId?: string;
    /** For a subset sig (`in`), the sigs it is a subset of. */
    subsetOf: string[];
    builtin: boolean;
    abstract: boolean;
    var: boolean;
    private: boolean;
    meta: boolean;
    /** Atoms whose most specific sig this is; for a subset sig, its members. */
    atoms: string[];
}

/** A field or a skolem of one state. */
export interface AlloyRelation {
    id: string;
    label: string;
    /** The sig declaring a field; undefined for a skolem. */
    parentId?: string;
    skolem: boolean;
    var: boolean;
    private: boolean;
    meta: boolean;
    tuples: string[][];
    /** The sig ids of the columns. */
    types: string[];
}

export interface AlloyState {
    sigs: AlloySig[];
    fields: AlloyRelation[];
    skolems: AlloyRelation[];
}

/** An instance: one state, or the states of a lasso trace. */
export interface AlloyInstance {
    /** E.g. `Run show for 3`. */
    command: string;
    filename: string;
    bitwidth: number;
    maxseq: number;
    traceLength: number;
    loopLength: number;
    /** The state the last one loops back to. */
    loopState: number;
    states: AlloyState[];
}

const yes = (element: XmlElement, name: string) => element.attributes[name] === 'yes';

function atomsOf(element: XmlElement): string[] {
    return element.children.filter(c => c.name === 'atom').map(c => c.attributes.label);
}

function relation(element: XmlElement, skolem: boolean): AlloyRelation {
    return {
        id: element.attributes.ID,
        label: element.attributes.label,
        parentId: element.attributes.parentID,
        skolem,
        var: yes(element, 'var'),
        private: yes(element, 'private'),
        meta: yes(element, 'meta'),
        tuples: element.children.filter(c => c.name === 'tuple').map(atomsOf),
        types: (element.children.find(c => c.name === 'types')?.children ?? []).map(t => t.attributes.ID)
    };
}

function state(element: XmlElement): AlloyState {
    const sigs: AlloySig[] = [];
    const fields: AlloyRelation[] = [];
    const skolems: AlloyRelation[] = [];
    for (const child of element.children) {
        if (child.name === 'sig') {
            sigs.push({
                id: child.attributes.ID,
                label: child.attributes.label,
                parentId: child.attributes.parentID,
                subsetOf: child.children.filter(c => c.name === 'type').map(t => t.attributes.ID),
                builtin: yes(child, 'builtin'),
                abstract: yes(child, 'abstract'),
                var: yes(child, 'var'),
                private: yes(child, 'private'),
                meta: yes(child, 'meta'),
                atoms: atomsOf(child)
            });
        } else if (child.name === 'field') {
            fields.push(relation(child, false));
        } else if (child.name === 'skolem') {
            skolems.push(relation(child, true));
        }
    }
    return { sigs, fields, skolems };
}

/** Reads the Analyzer's instance XML (`<alloy><instance>…`, one instance per state). */
export function parseInstance(xml: string): AlloyInstance {
    const alloy = parseXml(xml).children.find(c => c.name === 'alloy');
    const instances = alloy?.children.filter(c => c.name === 'instance') ?? [];
    if (instances.length === 0) throw new Error('The XML holds no Alloy instance.');
    const first = instances[0].attributes;
    const traceLength = Number(first.tracelength ?? instances.length) || instances.length;
    const loopLength = Number(first.looplength ?? 1) || 1;
    return {
        command: first.command ?? '',
        filename: first.filename ?? '',
        bitwidth: Number(first.bitwidth ?? 4),
        maxseq: Number(first.maxseq ?? 0),
        traceLength,
        loopLength,
        loopState: traceLength - loopLength,
        states: instances.map(state)
    };
}

/** Whether any sig or relation can change between states. */
export function isTemporal(instance: AlloyInstance): boolean {
    const s = instance.states[0];
    return s.sigs.some(x => x.var) || s.fields.some(x => x.var) || s.skolems.some(x => x.var);
}

/** The state after `index` in a lasso trace: the next one, or the loop state after the last. */
export function successor(instance: AlloyInstance, index: number): number {
    return index + 1 < instance.traceLength ? index + 1 : instance.loopState;
}

/** A sig's atoms including those of the sigs extending it; for a subset sig, its members. */
export function allAtoms(state: AlloyState, sig: AlloySig): string[] {
    const atoms = [...sig.atoms];
    for (const child of state.sigs) {
        if (child.parentId === sig.id && child.id !== sig.id) atoms.push(...allAtoms(state, child));
    }
    return atoms;
}

/** The sig an atom belongs to most specifically (not a subset sig). */
export function sigOfAtom(state: AlloyState, atom: string): AlloySig | undefined {
    return state.sigs.find(s => s.subsetOf.length === 0 && s.atoms.includes(atom));
}

/** The Analyzer's own sigs, which instances list but models don't declare. */
export const BUILTIN_SIGS: ReadonlySet<string> = new Set(['univ', 'Int', 'seq/Int', 'String', 'none']);

/** A label without `this/`, as the app shows sig names. */
export function shortLabel(label: string): string {
    return label.startsWith('this/') ? label.slice(5) : label;
}
