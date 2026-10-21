import { allAtoms, BUILTIN_SIGS, sigOfAtom, type AlloyState } from './instance.js';
import { themeName } from './dot.js';

// The app's "Instance as predicate": an Alloy predicate that holds exactly in
// this instance, to paste back into the model and run.

/** An atom as a variable name: `Node$1` becomes `Node_1`. */
function variable(atom: string): string {
    return atom.replace(/^this\//, '').replace(/[/$]/g, '_');
}

function term(atom: string): string {
    if (/^-?\d+$/.test(atom)) return atom;
    if (atom.startsWith('"')) return atom;
    return variable(atom);
}

function union(tuples: string[][]): string {
    return tuples.map(t => t.map(term).join('->')).join(' + ');
}

/** A predicate fixing every user sig, set and field of the state to its atoms. */
export function instanceAsPredicate(state: AlloyState, name = 'instance'): string {
    const userSigs = state.sigs.filter(s => !s.builtin && !BUILTIN_SIGS.has(s.label));
    const atoms = [...new Set(userSigs.flatMap(s => s.subsetOf.length === 0 ? s.atoms : []))];
    const declarations = atoms.map(atom => `${variable(atom)}: ${sigOfAtom(state, atom) ? themeName(sigOfAtom(state, atom)!) : 'univ'}`);
    const facts: string[] = [];
    for (const sig of userSigs) {
        const members = sig.subsetOf.length === 0 ? allAtoms(state, sig) : sig.atoms;
        facts.push(members.length > 0 ? `${themeName(sig)} = ${members.map(variable).join(' + ')}` : `no ${themeName(sig)}`);
    }
    for (const field of state.fields) {
        const owner = state.sigs.find(s => s.id === field.parentId);
        const qualified = owner ? `${themeName(owner)}<:${field.label}` : field.label;
        facts.push(field.tuples.length > 0 ? `${qualified} = ${union(field.tuples)}` : `no ${qualified}`);
    }
    const body = facts.map(f => `    ${f}`).join('\n');
    return declarations.length > 0
        ? `pred ${name} {\n  some disj ${declarations.join(', ')} {\n${body}\n  }\n}\n`
        : `pred ${name} {\n${body.replace(/^ {2}/gm, '')}\n}\n`;
}
