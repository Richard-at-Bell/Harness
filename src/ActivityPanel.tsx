import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ToolLine } from './workspace';

export function ActivityPanel({ tools }: { tools: ToolLine[] }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  if (!tools.length) return null;
  const visible = [...tools].reverse().filter(line => !errorsOnly || line.status === 'error');
  const shown = showAll ? visible : visible.slice(0, 5);
  const errors = tools.filter(line => line.status === 'error').length;

  return <section className="tool-activity" aria-label="Recent activity">
    <button className="activity-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
      <span>RECENT ACTIVITY <small>{tools.length}{errors ? ` · ${errors} errors` : ''}</small></span>
      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
    {open && <div className="activity-body">
      <div className="activity-filters"><button className={!errorsOnly ? 'selected' : ''} aria-pressed={!errorsOnly} onClick={() => setErrorsOnly(false)}>All</button><button className={errorsOnly ? 'selected' : ''} aria-pressed={errorsOnly} onClick={() => setErrorsOnly(true)}>Errors {errors ? `(${errors})` : ''}</button></div>
      {shown.length ? <div className="activity-list">{shown.map(line => <details key={line.id} className={`activity-item ${line.status}`}>
        <summary><span className="activity-status" aria-label={line.status}>{line.status === 'error' ? '!' : line.status === 'started' ? '·' : '✓'}</span><span className="activity-name">{line.name.replaceAll('_', ' ')}</span><span className="activity-target" title={line.summary}>{line.summary}</span><ChevronDown size={13} className="activity-chevron" /></summary>
        <div className="activity-debug"><div><span>Status</span><strong>{line.status === 'ok' ? 'Completed' : line.status === 'error' ? 'Failed' : 'Running'}</strong></div><div><span>Started</span><strong>{new Date(line.time).toLocaleTimeString()}</strong></div>{line.durationMs !== undefined && <div><span>Duration</span><strong>{line.durationMs} ms</strong></div>}{line.input && <div><span>Input</span><strong>{line.input}</strong></div>}{line.output && <div><span>Output</span><strong>{line.output}</strong></div>}<div><span>Tool call</span><code>{line.id}</code></div></div>
      </details>)}</div> : <p className="activity-empty">No errors in recent activity.</p>}
      {visible.length > 5 && <button className="activity-more" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show recent five' : `Show all ${visible.length}`}</button>}
    </div>}
  </section>;
}
