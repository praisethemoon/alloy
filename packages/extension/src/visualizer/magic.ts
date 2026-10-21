import { allAtoms, BUILTIN_SIGS, type AlloySig, type AlloyState } from './instance.js';
import { columnNames, themeName } from './dot.js';
import { emptyTheme, relationKey, setKey, type Color, type Shape, type Theme } from './theme.js';

// Magic Layout, after the app's MagicLayout and MagicColor: a theme guessed
// from the instance. It projects over time-like sigs, hides util/ordering's
// sigs, shows relations to enumerations and integers as attributes, colours
// up to five top-level sigs apart, gives sibling subsigs different shapes,
// and draws skolem sets bold. The app's exact heuristics are approximated.

/** MagicLayout.hasLikelyProjectionTypeName. */
const PROJECTION_NAMES = ['State', 'TrainState', 'Time', 'Tick', 'TimeStep'];
const MAGIC_COLORS: Color[] = ['Yellow', 'Green', 'Blue', 'Red', 'Gray'];
const MAGIC_SHAPES: Shape[] = ['Box', 'Ellipse', 'Hexagon', 'Octagon', 'Trapezoid', 'House', 'Parallelogram', 'Egg'];

function userSigs(state: AlloyState): AlloySig[] {
    return state.sigs.filter(s => !s.builtin && !BUILTIN_SIGS.has(s.label) && s.subsetOf.length === 0);
}

function isOrderingSig(sig: AlloySig): boolean {
    return themeName(sig).endsWith('/Ord');
}

/** An abstract sig all of whose subsigs are `one` sigs with no fields: an enumeration. */
function isEnumeration(state: AlloyState, sig: AlloySig): boolean {
    const children = state.sigs.filter(s => s.parentId === sig.id && s.id !== sig.id);
    return sig.abstract && children.length > 0
        && children.every(c => c.atoms.length === 1 && !state.fields.some(f => f.parentId === c.id))
        && !state.fields.some(f => f.parentId === sig.id);
}

/** A theme guessed from the state, as Magic Layout does. */
export function magicLayout(state: AlloyState, temporal: boolean): Theme {
    const theme = emptyTheme();
    const sigs = userSigs(state);
    const byId = new Map(state.sigs.map(s => [s.id, s]));

    // Time-like sigs are projected over, unless time is already Alloy 6's own.
    if (!temporal) {
        theme.projection = sigs
            .filter(s => s.parentId === undefined || byId.get(s.parentId)?.label === 'univ')
            .filter(s => PROJECTION_NAMES.includes(themeName(s).split('/').pop()!) && allAtoms(state, s).length > 1)
            .map(themeName);
    }

    for (const sig of sigs) {
        if (isOrderingSig(sig)) theme.types[themeName(sig)] = { visible: false };
    }

    // Relations to enumerations or integers read better as attributes.
    const enumerations = new Set(sigs.filter(s => isEnumeration(state, s)).map(themeName));
    for (const field of state.fields) {
        const columns = columnNames(state, field);
        const last = columns[columns.length - 1];
        if (columns.length === 2 && (enumerations.has(last) || last === 'Int')) {
            theme.relations[relationKey(field.label, columns)] = { visible: false, attribute: true };
        }
    }
    for (const name of enumerations) {
        theme.types[name] = { ...theme.types[name], visible: false };
    }

    // Top-level sigs apart by colour, when there are few enough to tell apart.
    const topLevel = sigs.filter(s => !isOrderingSig(s) && !enumerations.has(themeName(s))
        && !theme.projection.includes(themeName(s))
        && (s.parentId === undefined || byId.get(s.parentId)?.label === 'univ'));
    if (topLevel.length <= MAGIC_COLORS.length) {
        topLevel.forEach((sig, i) => { theme.types[themeName(sig)] = { ...theme.types[themeName(sig)], color: MAGIC_COLORS[i] }; });
    }

    // Sibling subsigs apart by shape.
    for (const parent of sigs) {
        const children = sigs.filter(s => s.parentId === parent.id && s.id !== parent.id);
        if (children.length < 2 || children.length > MAGIC_SHAPES.length) continue;
        children.forEach((child, i) => { theme.types[themeName(child)] = { ...theme.types[themeName(child)], shape: MAGIC_SHAPES[i] }; });
    }

    // Skolem sets stand out in bold.
    for (const skolem of state.skolems) {
        if (skolem.types.length === 1) theme.sets[setKey(skolem.label, columnNames(state, skolem)[0])] = { style: 'Bold' };
    }
    return theme;
}
