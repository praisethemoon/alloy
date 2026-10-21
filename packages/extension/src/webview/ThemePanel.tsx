import { useState } from 'react';
import { Button, Checkbox, Dropdown, FormHelper, Icon, Input, Label, Select } from 'baukasten-ui/core';
import { Accordion, AccordionItem, ButtonGroup, Drawer, DrawerBody, DrawerFooter, DrawerHeader, Menu, MenuItem } from 'baukasten-ui/extra';
import {
    COLORS, PALETTES, relationKey, setKey, SHAPES, STYLES,
    type EdgeSettings, type NodeSettings, type Palette, type Theme
} from '../visualizer/theme.js';

/** What the theme can be about in the instance on show. */
export interface ThemeSubjects {
    sigs: string[];
    sets: Array<{ name: string, type: string }>;
    relations: Array<{ name: string, columns: string[] }>;
}

const INHERIT = '(inherit)';
type Choice = string;

function options(values: readonly string[]) {
    return [{ value: INHERIT, label: 'Inherit' }, ...values.map(v => ({ value: v, label: v }))];
}

function boolOptions() {
    return options(['Yes', 'No']);
}

const fromBool = (value: boolean | undefined): Choice => value === undefined ? INHERIT : value ? 'Yes' : 'No';
const toBool = (value: Choice): boolean | undefined => value === INHERIT ? undefined : value === 'Yes';
const toValue = <T extends string>(value: Choice): T | undefined => value === INHERIT ? undefined : value as T;

/** Removes settings set back to Inherit, so the theme only says what was chosen. */
function without<T extends object>(settings: T): T {
    return Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)) as T;
}

// A label beside its control. baukasten's FormGroup columns can't shrink below
// Select's minimum width, which overflowed this narrow drawer; these can.
function Row({ label, children, help }: { label: string, children: React.ReactNode, help?: string }) {
    return (
        <div className="alloy-theme-row">
            <span className="alloy-theme-label">{label}</span>
            <div className="alloy-theme-control">
                {children}
                {help && <span className="alloy-theme-help">{help}</span>}
            </div>
        </div>
    );
}

function NodeEditor({ settings, onChange, set }: { settings: NodeSettings, onChange: (s: NodeSettings) => void, set?: boolean }) {
    const update = (patch: Partial<NodeSettings>) => onChange(without({ ...settings, ...patch }));
    return (
        <>
            <Row label="Show"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.visible)} onChange={v => update({ visible: toBool(v) })} /></Row>
            <Row label="Name" help="Replaces the sig's name in atom names.">
                <Input size="sm" fullWidth placeholder="Inherit" value={settings.label ?? ''} onChange={e => update({ label: e.target.value === '' ? undefined : e.target.value })} />
            </Row>
            <Row label="Colour"><Select size="sm" fullWidth options={options(COLORS)} value={settings.color ?? INHERIT} onChange={v => update({ color: toValue(v) })} /></Row>
            <Row label="Shape"><Select size="sm" fullWidth searchable options={options(SHAPES.map(s => s[0]))} value={settings.shape ?? INHERIT} onChange={v => update({ shape: toValue(v) })} /></Row>
            <Row label="Style"><Select size="sm" fullWidth options={options(STYLES)} value={settings.style ?? INHERIT} onChange={v => update({ style: toValue(v) })} /></Row>
            {set
                ? <>
                    <Row label="Show as labels"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.showAsLabel)} onChange={v => update({ showAsLabel: toBool(v) })} /></Row>
                    <Row label="Show in relation attributes"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.showInAttribute)} onChange={v => update({ showInAttribute: toBool(v) })} /></Row>
                </>
                : <>
                    <Row label="Hide unconnected nodes"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.hideUnconnected)} onChange={v => update({ hideUnconnected: toBool(v) })} /></Row>
                    <Row label="Number nodes"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.numberAtoms)} onChange={v => update({ numberAtoms: toBool(v) })} /></Row>
                </>}
        </>
    );
}

function EdgeEditor({ settings, onChange }: { settings: EdgeSettings, onChange: (s: EdgeSettings) => void }) {
    const update = (patch: Partial<EdgeSettings>) => onChange(without({ ...settings, ...patch }));
    return (
        <>
            <Row label="Show as arcs"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.visible)} onChange={v => update({ visible: toBool(v) })} /></Row>
            <Row label="Show as attribute"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.attribute)} onChange={v => update({ attribute: toBool(v) })} /></Row>
            <Row label="Name">
                <Input size="sm" fullWidth placeholder="Inherit" value={settings.label ?? ''} onChange={e => update({ label: e.target.value === '' ? undefined : e.target.value })} />
            </Row>
            <Row label="Colour"><Select size="sm" fullWidth options={options(COLORS)} value={settings.color ?? INHERIT} onChange={v => update({ color: toValue(v) })} /></Row>
            <Row label="Style"><Select size="sm" fullWidth options={options(STYLES)} value={settings.style ?? INHERIT} onChange={v => update({ style: toValue(v) })} /></Row>
            <Row label="Weight" help="A higher weight makes the edge shorter and straighter.">
                <Input size="sm" fullWidth type="number" min={0} placeholder="Inherit" value={settings.weight ?? ''}
                    onChange={e => update({ weight: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
            </Row>
            <Row label="Influence layout"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.constraint)} onChange={v => update({ constraint: toBool(v) })} /></Row>
            <Row label="Layout backwards"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.layoutBack)} onChange={v => update({ layoutBack: toBool(v) })} /></Row>
            <Row label="Merge arrows"><Select size="sm" fullWidth options={boolOptions()} value={fromBool(settings.merge)} onChange={v => update({ merge: toBool(v) })} /></Row>
        </>
    );
}

export interface ThemePanelProps {
    open: boolean;
    theme: Theme;
    themeName?: string;
    subjects: ThemeSubjects;
    onChange: (theme: Theme) => void;
    onMagic: () => void;
    onReset: () => void;
    onLoad: () => void;
    onLoadSample: () => void;
    onSave: (saveAs: boolean) => void;
    onClose: () => void;
}

/** The app's theme customisation panel. Changes apply as they are made. */
export function ThemePanel(props: ThemePanelProps) {
    const { theme, subjects, onChange } = props;
    const [sig, setSig] = useState<string>();
    const [set, setSet] = useState<string>();
    const [relation, setRelation] = useState<string>();
    const sigKey = sig && subjects.sigs.includes(sig) ? sig : subjects.sigs[0];
    const setNames = subjects.sets.map(s => setKey(s.name, s.type));
    const currentSet = set && setNames.includes(set) ? set : setNames[0];
    const relationKeys = subjects.relations.map(r => relationKey(r.name, r.columns));
    const currentRelation = relation && relationKeys.includes(relation) ? relation : relationKeys[0];
    const toggle = (key: 'useOriginalAtomNames' | 'hidePrivate' | 'hideSkolem' | 'hideMeta', label: string) => (
        <Label key={key} variant="checkbox" size="sm">
            <Checkbox size="sm" checked={theme[key]} onChange={e => onChange({ ...theme, [key]: e.target.checked })} />
            <span>{label}</span>
        </Label>
    );

    return (
        <Drawer open={props.open} onClose={props.onClose} placement="right" size="420px" backdropVariant="transparent">
            <DrawerHeader onClose={props.onClose}>Theme{props.themeName ? `: ${props.themeName}` : ''}</DrawerHeader>
            <DrawerBody>
                <Accordion className="alloy-theme">
                    <AccordionItem title="General graph settings" defaultOpen>
                        <Row label="Node colour palette">
                            <Select size="sm" fullWidth options={PALETTES.map(p => ({ value: p, label: p }))} value={theme.nodePalette} onChange={v => onChange({ ...theme, nodePalette: v as Palette })} />
                        </Row>
                        <Row label="Edge colour palette">
                            <Select size="sm" fullWidth options={PALETTES.map(p => ({ value: p, label: p }))} value={theme.edgePalette} onChange={v => onChange({ ...theme, edgePalette: v as Palette })} />
                        </Row>
                        <Row label="Font size">
                            <Select size="sm" fullWidth options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map(n => ({ value: String(n), label: String(n) }))}
                                value={String(theme.fontSize)} onChange={v => onChange({ ...theme, fontSize: Number(v) })} />
                        </Row>
                        <div className="alloy-theme-flags">
                            {toggle('useOriginalAtomNames', 'Use original atom names')}
                            {toggle('hidePrivate', 'Hide private sigs and relations')}
                            {toggle('hideSkolem', 'Hide skolem sigs and relations')}
                            {toggle('hideMeta', 'Hide meta sigs and relations')}
                        </div>
                    </AccordionItem>
                    <AccordionItem title="Default node settings">
                        <NodeEditor settings={theme.defaultNode} onChange={s => onChange({ ...theme, defaultNode: s })} />
                    </AccordionItem>
                    <AccordionItem title="Default edge settings">
                        <EdgeEditor settings={theme.defaultEdge} onChange={s => onChange({ ...theme, defaultEdge: s })} />
                    </AccordionItem>
                    <AccordionItem title="Sigs" defaultOpen>
                        {sigKey
                            ? <>
                                <Row label="Sig">
                                    <Select size="sm" fullWidth searchable options={subjects.sigs.map(s => ({ value: s, label: s }))} value={sigKey} onChange={setSig} />
                                </Row>
                                <div className="alloy-theme-check">
                                    <Label variant="checkbox" size="sm">
                                        <Checkbox size="sm" checked={theme.projection.includes(sigKey)}
                                            onChange={e => onChange({ ...theme, projection: e.target.checked ? [...theme.projection, sigKey] : theme.projection.filter(t => t !== sigKey) })} />
                                        <span>Project over this sig</span>
                                    </Label>
                                </div>
                                <NodeEditor settings={theme.types[sigKey] ?? {}} onChange={s => onChange({ ...theme, types: { ...theme.types, [sigKey]: s } })} />
                            </>
                            : <FormHelper>This instance has no sigs to customise.</FormHelper>}
                    </AccordionItem>
                    <AccordionItem title="Sets">
                        {currentSet
                            ? <>
                                <Row label="Set">
                                    <Select size="sm" fullWidth options={subjects.sets.map(s => ({ value: setKey(s.name, s.type), label: `${s.name} (${s.type})` }))} value={currentSet} onChange={setSet} />
                                </Row>
                                <NodeEditor set settings={theme.sets[currentSet] ?? {}} onChange={s => onChange({ ...theme, sets: { ...theme.sets, [currentSet]: s } })} />
                            </>
                            : <FormHelper>This instance has no subset sigs or skolem sets.</FormHelper>}
                    </AccordionItem>
                    <AccordionItem title="Relations" defaultOpen>
                        {currentRelation
                            ? <>
                                <Row label="Relation">
                                    <Select size="sm" fullWidth searchable
                                        options={subjects.relations.map(r => ({ value: relationKey(r.name, r.columns), label: `${r.name}: ${r.columns.join(' -> ')}` }))}
                                        value={currentRelation} onChange={setRelation} />
                                </Row>
                                <EdgeEditor settings={theme.relations[currentRelation] ?? {}} onChange={s => onChange({ ...theme, relations: { ...theme.relations, [currentRelation]: s } })} />
                            </>
                            : <FormHelper>This instance has no relations.</FormHelper>}
                    </AccordionItem>
                </Accordion>
            </DrawerBody>
            <DrawerFooter>
                <div className="alloy-theme-actions">
                    <Button size="sm" variant="secondary" onClick={props.onMagic}>Magic Layout</Button>
                    <Button size="sm" variant="secondary" onClick={props.onReset}>Reset</Button>
                    <span className="alloy-theme-spacer" />
                    <Dropdown placement="top-end" trigger={<Button size="sm" variant="secondary">Load <Icon name="chevron-up" /></Button>}>
                        <Menu size="sm">
                            <MenuItem onClick={props.onLoad}>Load Theme…</MenuItem>
                            <MenuItem onClick={props.onLoadSample}>Load Sample Theme…</MenuItem>
                        </Menu>
                    </Dropdown>
                    <ButtonGroup>
                        <Button size="sm" variant="primary" onClick={() => props.onSave(false)}>Save</Button>
                        <ButtonGroup.Dropdown size="sm" variant="primary" placement="top-end" ariaLabel="More save options"
                            content={<Menu size="sm"><MenuItem onClick={() => props.onSave(true)}>Save Theme As…</MenuItem></Menu>} />
                    </ButtonGroup>
                </div>
            </DrawerFooter>
        </Drawer>
    );
}
