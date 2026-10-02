import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { loadLiveModels, MODEL_CHOICES, modelName, pricePerMillion, type LiveModel } from './models';

export function ModelPicker({ modelId, connected, locked, onSelect }: { modelId: string; connected: boolean; locked: boolean; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<Map<string, LiveModel> | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();

  useEffect(() => { if (locked) setOpen(false); }, [locked]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    loadLiveModels(controller.signal).then(setModels).catch(() => {
      if (!controller.signal.aborted) { setModels(null); setFailed(true); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, retry]);

  useEffect(() => {
    if (!open) return;
    const selected = options.current.find(option => option?.getAttribute('aria-selected') === 'true' && !option.disabled);
    (selected || options.current.find(option => option && !option.disabled))?.focus();
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function close() { setOpen(false); trigger.current?.focus(); }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const available = options.current.filter((option): option is HTMLButtonElement => Boolean(option && !option.disabled));
    if (!available.length) return;
    const current = available.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : current < 0 ? (event.key === 'ArrowDown' ? 0 : available.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length;
    available[next].focus();
  }

  return <div className="model-picker" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" className="model-button" disabled={locked} aria-label={`Choose agent model, current: ${modelName(modelId)}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <span className={connected ? 'model-dot ready' : 'model-dot'} /><span className="model-current-name">{modelName(modelId)}</span><ChevronDown size={13} />
    </button>
    {open && <div className="model-picker-menu" onKeyDown={navigate}>
      <div className="model-picker-heading"><strong>Agent model</strong><span>USD / 1M tokens</span></div>
      <div className="model-picker-columns" aria-hidden="true"><span>Model</span><span>Input</span><span>Output</span></div>
      <div id={listId} role="listbox" aria-label="Agent models" aria-busy={loading}>
        {MODEL_CHOICES.map((choice, index) => {
          const live = models?.get(choice.id);
          const input = pricePerMillion(live?.pricing?.prompt);
          const output = pricePerMillion(live?.pricing?.completion);
          const unavailable = Boolean(models && !live);
          return <button key={choice.id} ref={element => { options.current[index] = element; }} type="button" className="model-picker-option" role="option" aria-selected={modelId === choice.id} aria-label={`${choice.name}, input ${input ?? 'price unavailable'}, output ${output ?? 'price unavailable'} per million tokens${unavailable ? ', unavailable' : ''}`} disabled={unavailable} tabIndex={-1} onClick={() => { onSelect(choice.id); close(); }}>
            <span className="model-picker-name">{modelId === choice.id ? <Check size={12} /> : <span className="model-picker-check-space" />}<span>{choice.name}</span></span>
            <span className="model-picker-rate">{input ?? '—'}</span><span className="model-picker-rate">{output ?? '—'}</span>
          </button>;
        })}
      </div>
      {(loading || failed) && <div className="model-picker-status" role="status">{loading ? 'Updating prices…' : <>Prices unavailable.<button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></>}</div>}
    </div>}
  </div>;
}
