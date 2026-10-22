// The graph view's colours: a theme's colours (the tones the dot names) drawn
// in baukasten's tokens, so the graph follows the editor's light or dark theme.
// Exports keep Graphviz's own colours, from the theme's palettes.

const DANGER = 'var(--bk-color-danger)';
const WARNING = 'var(--bk-color-warning)';
const SUCCESS = 'var(--bk-color-success)';
const INFO = 'var(--bk-color-info)';
const FOREGROUND = 'var(--bk-color-foreground)';
const MUTED = 'var(--bk-color-foreground-muted)';
const SURFACE = 'var(--bk-color-background-elevated)';

const mix = (a: string, b: string, percent: number) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;

/** The token each theme colour stands for. */
const HUES: Record<string, string> = {
    yellow: WARNING, green: SUCCESS, blue: INFO, red: DANGER, gray: MUTED, white: SURFACE, black: FOREGROUND
};

/** The colours relations left to Magic take in turn: the semantic hues, then blends of them. */
const MAGIC = [DANGER, INFO, SUCCESS, WARNING, mix(DANGER, INFO, 50), mix(SUCCESS, INFO, 50), mix(WARNING, DANGER, 50)];

export interface NodeColors {
    fill: string;
    stroke: string;
    /** The label's colour. */
    ink: string;
}

/** A node's colours: a tint of its hue on the editor's surface, outlined in the hue; undefined for no tone. */
export function nodeColors(tone: string | undefined): NodeColors | undefined {
    const name = tone?.replace(/^tone-/, '');
    if (!name || !(name in HUES)) return undefined;
    if (name === 'white') return { fill: SURFACE, stroke: MUTED, ink: FOREGROUND };
    if (name === 'black') return { fill: FOREGROUND, stroke: FOREGROUND, ink: 'var(--bk-color-background)' };
    return { fill: mix(HUES[name], SURFACE, 28), stroke: HUES[name], ink: FOREGROUND };
}

/** An edge's colour: its hue, or the Magic colour for its relation's index; undefined for no tone. */
export function edgeColor(tone: string | undefined): string | undefined {
    const name = tone?.replace(/^tone-/, '');
    if (!name) return undefined;
    const magic = /^magic-(\d+)$/.exec(name);
    if (magic) return MAGIC[Number(magic[1]) % MAGIC.length];
    // White and black arcs would vanish on one theme or the other; both draw in the text colour.
    if (name === 'white' || name === 'black') return FOREGROUND;
    return HUES[name];
}
