import { successor, type AlloyInstance } from '../visualizer/instance.js';

const STEP = 44;
const RADIUS = 13;
const TOP = 16;

/**
 * The lasso above the states, as in the app: states 0…n−1 in a row, an arc
 * from the last back to the loop state, and the two states on show
 * highlighted. Clicking a state shows it on the left.
 */
export function TraceBar({ instance, focus, onFocus }: { instance: AlloyInstance, focus: number, onFocus: (state: number) => void }) {
    const count = instance.traceLength;
    const next = successor(instance, focus);
    const x = (i: number) => RADIUS + 4 + i * STEP;
    const width = x(count - 1) + RADIUS + 8;
    const loopFrom = x(count - 1);
    const loopTo = x(instance.loopState);
    const height = TOP + RADIUS + 18;
    return (
        <svg className="alloy-trace" width={width} height={height} role="group" aria-label={`Trace of ${count} states, looping back to state ${instance.loopState}`}>
            <defs>
                <marker id="alloy-trace-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--bk-color-foreground-muted)" />
                </marker>
            </defs>
            {Array.from({ length: count - 1 }, (_, i) => (
                <line key={`step${i}`} x1={x(i) + RADIUS} y1={TOP + RADIUS} x2={x(i + 1) - RADIUS - 2} y2={TOP + RADIUS}
                    stroke="var(--bk-color-foreground-muted)" markerEnd="url(#alloy-trace-arrow)" />
            ))}
            <path
                d={loopFrom === loopTo
                    ? `M ${loopFrom + 6} ${TOP + 2} C ${loopFrom + 22} ${TOP - 18}, ${loopFrom - 22} ${TOP - 18}, ${loopFrom - 6} ${TOP + 2}`
                    : `M ${loopFrom} ${TOP} C ${loopFrom} ${TOP - 16}, ${loopTo} ${TOP - 16}, ${loopTo} ${TOP}`}
                fill="none" stroke="var(--bk-color-foreground-muted)" markerEnd="url(#alloy-trace-arrow)" />
            {Array.from({ length: count }, (_, i) => {
                const shown = i === focus || i === next;
                return (
                    <g key={i} role="button" tabIndex={0} aria-label={`State ${i}`} aria-pressed={i === focus}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onFocus(i)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onFocus(i); }}>
                        <circle cx={x(i)} cy={TOP + RADIUS} r={RADIUS}
                            fill={i === focus ? 'var(--bk-color-primary)' : shown ? 'var(--bk-color-selected)' : 'var(--bk-color-background-secondary)'}
                            stroke={shown ? 'var(--bk-color-border-focus)' : 'var(--bk-color-border)'} />
                        <text x={x(i)} y={TOP + RADIUS + 4} textAnchor="middle" fontSize="11"
                            fill={i === focus ? 'var(--bk-color-primary-foreground)' : 'var(--bk-color-foreground)'}>{i}</text>
                    </g>
                );
            })}
        </svg>
    );
}
