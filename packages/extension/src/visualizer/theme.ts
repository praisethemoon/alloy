import { parseXml, type XmlElement } from './xml.js';

// The Alloy app's themes (.thm files), as StaticThemeReaderWriter reads and
// writes them, with the colours, shapes, styles and palettes of alloy4graph.

export const PALETTES = ['Classic', 'Standard', 'Martha', 'Neon', 'Tol'] as const;
export type Palette = typeof PALETTES[number];

export const COLORS = ['Magic', 'Yellow', 'Green', 'Blue', 'Red', 'Gray', 'White', 'Black'] as const;
export type Color = typeof COLORS[number];

export const STYLES = ['Solid', 'Dashed', 'Dotted', 'Bold'] as const;
export type Style = typeof STYLES[number];

/** DotShape: the name a theme uses, and Graphviz's. */
export const SHAPES = [
    ['Ellipse', 'ellipse'], ['Box', 'box'], ['Circle', 'circle'], ['Egg', 'egg'], ['Triangle', 'triangle'],
    ['Diamond', 'diamond'], ['Trapezoid', 'trapezium'], ['Parallelogram', 'parallelogram'], ['House', 'house'],
    ['Hexagon', 'hexagon'], ['Octagon', 'octagon'], ['Dbl Circle', 'doublecircle'], ['Dbl Octagon', 'doubleoctagon'],
    ['Tpl Octagon', 'tripleoctagon'], ['Inv Triangle', 'invtriangle'], ['Inv House', 'invhouse'],
    ['Inv Trapezoid', 'invtrapezium'], ['Lined Diamond', 'Mdiamond'], ['Lined Square', 'Msquare'], ['Lined Circle', 'Mcircle']
] as const;
export type Shape = typeof SHAPES[number][0];

// DotColor's Graphviz colours per palette (Classic, Standard, Martha, Neon, Tol).
// The Tol entries are Paul Tol's light scheme, which the app's colour-blind palette uses.
const COLOR_TABLE: Record<Exclude<Color, 'Magic'>, string[]> = {
    Yellow: ['gold', 'yellow', 'lightgoldenrod', 'yellow', '#EEDD88'],
    Green: ['limegreen', 'green2', 'darkolivegreen2', 'chartreuse2', '#44BB99'],
    Blue: ['cornflowerblue', 'blue', 'cadetblue', 'cyan', '#77AADD'],
    Red: ['palevioletred', 'red', 'salmon', 'magenta', '#FFAABB'],
    Gray: ['lightgray', 'lightgray', 'lightgray', 'lightgray', '#DDDDDD'],
    White: ['white', 'white', 'white', 'white', 'white'],
    Black: ['black', 'black', 'black', 'black', 'black']
};

/** StaticGraphMaker's colours for relations left to Magic, per palette. */
const MAGIC_EDGE_COLORS: Record<Palette, string[]> = {
    Classic: ['#e41a1c', '#a65628', '#ff7f00', '#4daf4a', '#377eb8', '#984ea3'],
    Standard: ['#e31a1c', '#ff7f00', '#c87b7a', '#33a02c', '#1f78b4'],
    Martha: ['#e78ac3', '#fc8d62', '#a6d854', '#66c2a5', '#8da0cb'],
    Neon: ['#e7298a', '#d95f02', '#a6761d', '#66a61e', '#1b9e77', '#7570b3'],
    Tol: ['#77aadd', '#99ddff', '#bbcc33', '#aaaa00', '#ee8866', '#ffaabb', '#dddddd']
};

/** The Graphviz colour of a theme colour in a palette; Magic has none of its own. */
export function dotColor(color: Exclude<Color, 'Magic'>, palette: Palette): string {
    return COLOR_TABLE[color][PALETTES.indexOf(palette)];
}

/** The colour a relation gets when its colour is Magic: the palette's next one. */
export function magicEdgeColor(palette: Palette, index: number): string {
    const colors = MAGIC_EDGE_COLORS[palette];
    return colors[index % colors.length];
}

export function dotShape(shape: Shape): string {
    return SHAPES.find(([name]) => name === shape)![1];
}

/** How sigs and sets are drawn. Undefined means inherit. */
export interface NodeSettings {
    visible?: boolean;
    /** Replaces the sig's name in atom names; '' keeps it. */
    label?: string;
    color?: Color;
    shape?: Shape;
    style?: Style;
    hideUnconnected?: boolean;
    numberAtoms?: boolean;
    /** For sets: show membership as a line in the atom's label. */
    showAsLabel?: boolean;
    /** For sets: show membership in relation attributes. */
    showInAttribute?: boolean;
}

/** How relations are drawn. Undefined means inherit. */
export interface EdgeSettings {
    visible?: boolean;
    label?: string;
    color?: Color;
    style?: Style;
    weight?: number;
    /** Show as an attribute line on the source atom instead of (or besides) arcs. */
    attribute?: boolean;
    /** Merge opposing arrows into one with heads at both ends. */
    merge?: boolean;
    /** Whether the arcs influence the layout. */
    constraint?: boolean;
    /** Lay out as if the arcs were reversed. */
    layoutBack?: boolean;
}

export interface Theme {
    nodePalette: Palette;
    edgePalette: Palette;
    fontSize: number;
    useOriginalAtomNames: boolean;
    hidePrivate: boolean;
    hideSkolem: boolean;
    hideMeta: boolean;
    /** The sigs (theme names, e.g. `Time`) projected over. */
    projection: string[];
    defaultNode: NodeSettings;
    defaultEdge: EdgeSettings;
    /** By sig name as themes write it: no `this/`. */
    types: Record<string, NodeSettings>;
    /** By `name:type`. */
    sets: Record<string, NodeSettings>;
    /** By `name:type,type…`. */
    relations: Record<string, EdgeSettings>;
}

/** A theme with nothing customised: the app's reset state. */
export function emptyTheme(): Theme {
    return {
        nodePalette: 'Classic', edgePalette: 'Classic', fontSize: 12, useOriginalAtomNames: false,
        hidePrivate: true, hideSkolem: false, hideMeta: true, projection: [],
        defaultNode: {}, defaultEdge: {}, types: {}, sets: {}, relations: {}
    };
}

/** What a node is drawn with when nothing else says (VizState.resetTheme). */
export const BUILTIN_NODE: Required<NodeSettings> = {
    visible: true, label: '', color: 'Yellow', shape: 'Box', style: 'Solid',
    hideUnconnected: false, numberAtoms: true, showAsLabel: true, showInAttribute: false
};

/** What an edge is drawn with when nothing else says. */
export const BUILTIN_EDGE: Required<EdgeSettings> = {
    visible: true, label: '', color: 'Magic', style: 'Solid', weight: 0,
    attribute: false, merge: true, constraint: true, layoutBack: false
};

export function setKey(name: string, type: string): string {
    return `${name}:${type}`;
}

export function relationKey(name: string, types: string[]): string {
    return `${name}:${types.join(',')}`;
}

// --- reading

function flag(value: string | undefined): boolean | undefined {
    return value === 'yes' ? true : value === 'no' ? false : undefined;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
    if (!value || value === 'inherit') return undefined;
    return values.find(v => v.toLowerCase() === value.toLowerCase());
}

function nodeSettings(element: XmlElement): NodeSettings {
    const a = element.attributes;
    return clean({
        visible: flag(a.visible),
        label: a.label,
        color: oneOf(COLORS, a.color),
        shape: oneOf(SHAPES.map(s => s[0]), a.shape) as Shape | undefined,
        style: oneOf(STYLES, a.style),
        hideUnconnected: flag(a.hideunconnected),
        numberAtoms: flag(a.numberatoms),
        showAsLabel: flag(a.showlabel),
        showInAttribute: flag(a.showinattr)
    });
}

function edgeSettings(element: XmlElement): EdgeSettings {
    const a = element.attributes;
    return clean({
        visible: flag(a.visible),
        label: a.label,
        color: oneOf(COLORS, a.color),
        style: oneOf(STYLES, a.style),
        weight: a.weight !== undefined && a.weight !== 'inherit' ? Number(a.weight) : undefined,
        attribute: flag(a.attribute),
        merge: flag(a.merge),
        constraint: flag(a.constraint),
        layoutBack: flag(a.layout)
    });
}

function clean<T extends object>(settings: T): T {
    for (const key of Object.keys(settings) as Array<keyof T>) {
        if (settings[key] === undefined) delete settings[key];
    }
    return settings;
}

/** Reads a .thm file as the app writes it. */
export function parseTheme(xml: string): Theme {
    const view = parseXml(xml).children.find(c => c.name === 'alloy')?.children.find(c => c.name === 'view');
    if (!view) throw new Error('This is not an Alloy theme: it has no <view>.');
    const theme = emptyTheme();
    const v = view.attributes;
    theme.nodePalette = oneOf(PALETTES, v.nodetheme) ?? theme.nodePalette;
    theme.edgePalette = oneOf(PALETTES, v.edgetheme) ?? theme.edgePalette;
    if (v.fontsize) theme.fontSize = Number(v.fontsize);
    theme.useOriginalAtomNames = flag(v.useOriginalAtomNames) ?? theme.useOriginalAtomNames;
    theme.hidePrivate = flag(v.hidePrivate) ?? theme.hidePrivate;
    theme.hideSkolem = flag(v.hideSkolem) ?? theme.hideSkolem;
    theme.hideMeta = flag(v.hideMeta) ?? theme.hideMeta;
    for (const child of view.children) {
        switch (child.name) {
            case 'projection':
                theme.projection = child.children.filter(t => t.name === 'type').map(t => t.attributes.name);
                break;
            case 'defaultnode':
                theme.defaultNode = nodeSettings(child);
                break;
            case 'defaultedge':
                theme.defaultEdge = edgeSettings(child);
                break;
            case 'node': {
                const settings = nodeSettings(child);
                for (const member of child.children) {
                    if (member.name === 'type') theme.types[member.attributes.name] = { ...settings };
                    if (member.name === 'set') theme.sets[setKey(member.attributes.name, member.attributes.type)] = { ...settings };
                }
                break;
            }
            case 'edge': {
                const settings = edgeSettings(child);
                for (const relation of child.children.filter(r => r.name === 'relation')) {
                    const types = relation.children.filter(t => t.name === 'type').map(t => t.attributes.name);
                    theme.relations[relationKey(relation.attributes.name, types)] = { ...settings };
                }
                break;
            }
        }
    }
    return theme;
}

// --- writing

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const yesNo = (value: boolean) => value ? 'yes' : 'no';

function nodeAttributes(s: NodeSettings): string {
    const parts: string[] = [];
    if (s.visible !== undefined) parts.push(`visible="${yesNo(s.visible)}"`);
    if (s.label !== undefined) parts.push(`label="${esc(s.label)}"`);
    if (s.color !== undefined) parts.push(`color="${s.color}"`);
    if (s.shape !== undefined) parts.push(`shape="${s.shape}"`);
    if (s.style !== undefined) parts.push(`style="${s.style}"`);
    if (s.hideUnconnected !== undefined) parts.push(`hideunconnected="${yesNo(s.hideUnconnected)}"`);
    if (s.numberAtoms !== undefined) parts.push(`numberatoms="${yesNo(s.numberAtoms)}"`);
    if (s.showAsLabel !== undefined) parts.push(`showlabel="${yesNo(s.showAsLabel)}"`);
    if (s.showInAttribute !== undefined) parts.push(`showinattr="${yesNo(s.showInAttribute)}"`);
    return parts.map(p => ' ' + p).join('');
}

function edgeAttributes(s: EdgeSettings): string {
    const parts: string[] = [];
    if (s.visible !== undefined) parts.push(`visible="${yesNo(s.visible)}"`);
    if (s.label !== undefined) parts.push(`label="${esc(s.label)}"`);
    if (s.color !== undefined) parts.push(`color="${s.color}"`);
    if (s.style !== undefined) parts.push(`style="${s.style}"`);
    if (s.weight !== undefined) parts.push(`weight="${s.weight}"`);
    if (s.attribute !== undefined) parts.push(`attribute="${yesNo(s.attribute)}"`);
    if (s.merge !== undefined) parts.push(`merge="${yesNo(s.merge)}"`);
    if (s.constraint !== undefined) parts.push(`constraint="${yesNo(s.constraint)}"`);
    if (s.layoutBack !== undefined) parts.push(`layout="${yesNo(s.layoutBack)}"`);
    return parts.map(p => ' ' + p).join('');
}

/** Groups keys sharing the same written attributes, as the app writes them. */
function grouped<T>(entries: Array<[string, T]>, attributes: (s: T) => string): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const [key, settings] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        const attrs = attributes(settings);
        if (!groups.has(attrs)) groups.set(attrs, []);
        groups.get(attrs)!.push(key);
    }
    return groups;
}

/** Writes a theme as the app does, so the app can load it. */
export function writeTheme(theme: Theme): string {
    const view: string[] = [];
    if (theme.nodePalette !== 'Classic') view.push(`nodetheme="${theme.nodePalette}"`);
    if (theme.edgePalette !== 'Classic') view.push(`edgetheme="${theme.edgePalette}"`);
    if (theme.fontSize !== 12) view.push(`fontsize="${theme.fontSize}"`);
    if (theme.useOriginalAtomNames) view.push('useOriginalAtomNames="yes"');
    if (!theme.hidePrivate) view.push('hidePrivate="no"');
    if (theme.hideSkolem) view.push('hideSkolem="yes"');
    if (!theme.hideMeta) view.push('hideMeta="no"');
    const out: string[] = ['<?xml version="1.0"?>', '<alloy>', '', `<view${view.map(v => ' ' + v).join('')}>`, ''];
    out.push(theme.projection.length > 0
        ? `<projection>${theme.projection.map(t => ` <type name="${esc(t)}"/>`).join('')} </projection>`
        : '<projection/>');
    out.push('', `<defaultnode${nodeAttributes(theme.defaultNode)}/>`, '', `<defaultedge${edgeAttributes(theme.defaultEdge)}/>`);
    const nodes = grouped<{ kind: 'type' | 'set', settings: NodeSettings }>([
        ...Object.entries(theme.types).map(([k, s]) => [k, { kind: 'type' as const, settings: s }] as [string, { kind: 'type', settings: NodeSettings }]),
        ...Object.entries(theme.sets).map(([k, s]) => [k, { kind: 'set' as const, settings: s }] as [string, { kind: 'set', settings: NodeSettings }])
    ], n => nodeAttributes(n.settings));
    for (const [attrs, keys] of nodes) {
        out.push('', `<node${attrs}>`);
        for (const key of keys) {
            if (key in theme.types) {
                out.push(`   <type name="${esc(key)}"/>`);
            } else {
                const [name, type] = key.split(':');
                out.push(`   <set name="${esc(name)}" type="${esc(type)}"/>`);
            }
        }
        out.push('</node>');
    }
    for (const [attrs, keys] of grouped(Object.entries(theme.relations), edgeAttributes)) {
        out.push('', `<edge${attrs}>`);
        for (const key of keys) {
            const [name, types] = key.split(':');
            out.push(`   <relation name="${esc(name)}">${types.split(',').map(t => ` <type name="${esc(t)}"/>`).join('')} </relation>`);
        }
        out.push('</edge>');
    }
    out.push('', '</view>', '', '</alloy>', '');
    return out.join('\n');
}
