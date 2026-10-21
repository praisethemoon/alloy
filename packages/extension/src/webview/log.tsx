import 'baukasten-ui/dist/baukasten-base.css';
import 'baukasten-ui/dist/baukasten-vscode.css';
import './log.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge, Button, Icon, IconButton, Tooltip } from 'baukasten-ui/core';
import type { FromLog, LogEntryView, ToLog } from '../visualizer/log-protocol.js';

interface LogHost {
    postMessage(message: FromLog): void;
}

declare function acquireVsCodeApi(): LogHost;
const host = acquireVsCodeApi();

const BADGE = { found: 'warning', none: 'success', error: 'error' } as const;

function Entry({ entry }: { entry: LogEntryView }) {
    const send = (message: FromLog) => host.postMessage(message);
    return (
        <article className="alloy-log-entry" aria-label={`${entry.title}: ${entry.text}`}>
            <header className="alloy-log-head">
                <span className="alloy-log-time">{entry.time}</span>
                <strong>{entry.title}</strong>
                <span className="alloy-log-muted">{entry.file} · {entry.solver}</span>
            </header>
            <div className="alloy-log-body">
                <Badge size="sm" variant={BADGE[entry.tone]}>{entry.tone === 'found' ? (entry.instance ?? 'Found') : entry.tone === 'error' ? 'Error' : 'None'}</Badge>
                <span>{entry.text}</span>
            </div>
            {(entry.instance || entry.core > 0 || entry.kodkod) && (
                <div className="alloy-log-links">
                    {entry.instance && <Button size="sm" variant="link" onClick={() => send({ type: 'instance', id: entry.id })}>{entry.instance}</Button>}
                    {entry.core > 0 && <Button size="sm" variant="link" onClick={() => send({ type: 'core', id: entry.id })}>Core ({entry.core})</Button>}
                    {entry.kodkod && <Button size="sm" variant="link" onClick={() => send({ type: 'kodkod', id: entry.id })}>Predicate (Kodkod)</Button>}
                </div>
            )}
            {entry.warnings.length > 0 && (
                <ul className="alloy-log-warnings">
                    {entry.warnings.map((w, i) => (
                        <li key={i}>
                            <Icon name="warning" />
                            <Button size="sm" variant="link" onClick={() => send({ type: 'warning', id: entry.id, index: i })}>
                                {w.line ? `Line ${w.line}: ` : ''}{w.message}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </article>
    );
}

function Log() {
    const [entries, setEntries] = useState<LogEntryView[]>([]);
    useEffect(() => {
        const receive = (event: MessageEvent<ToLog>) => { if (event.data.type === 'entries') setEntries(event.data.entries); };
        window.addEventListener('message', receive);
        host.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', receive);
    }, []);
    return (
        <div className="alloy-log">
            <div className="alloy-log-toolbar">
                <span className="alloy-log-muted">{entries.length === 0 ? 'Run or check a command to see it here.' : `${entries.length} run${entries.length === 1 ? '' : 's'}`}</span>
                <Tooltip content="Clear the log" placement="left">
                    <IconButton size="sm" variant="ghost" icon={<Icon name="clear-all" />} aria-label="Clear the log" disabled={entries.length === 0} onClick={() => host.postMessage({ type: 'clear' })} />
                </Tooltip>
            </div>
            {entries.map(e => <Entry key={e.id} entry={e} />)}
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<Log />);
