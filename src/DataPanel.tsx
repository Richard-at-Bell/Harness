import { memo, useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useStore } from 'zustand';
import { useDocuments } from './documentContext';
import { defaultValue, generateRows, tablePath, type Table } from './fixtures';
import { useStudio, useWorkspace } from './studioContext';

// Keep intermediate numeric text (for example "12.") in the editing cell.
// Invalid text remains recoverable in the draft and fails shared save validation.
function NumberCell({ value, label, disabled, onChange }: { value: string | number | boolean | null; label: string; disabled: boolean; onChange: (value: string | number) => void }) {
  const [text, setText] = useState(String(value ?? '')), focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value ?? '')); }, [value]);
  return <input aria-label={label} inputMode="decimal" disabled={disabled} placeholder={value === null ? 'null' : undefined} value={text}
    onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setText(String(value ?? '')); }}
    onChange={event => { const raw = event.target.value; setText(raw); onChange(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ? Number(raw) : raw); }} />;
}

export const DataPanel = memo(function DataPanel({ selectedTableId, onImport }: { selectedTableId: string; onImport: () => void }) {
  const studio = useStudio(), { tables: documents } = useDocuments();
  const acceptedPath = useWorkspace(state => tablePath(state.fixtures, selectedTableId));
  const draft = useStore(documents.store, state => state.drafts.get(selectedTableId));
  const [generationSeed, setGenerationSeed] = useState(42), [generationCount, setGenerationCount] = useState(8), [offset, setOffset] = useState(0);
  const table = draft?.table ?? null;
  useEffect(() => {
    documents.start(); const unsubscribe = studio.workspace.store.subscribe(state => documents.observe(state.fixtures));
    return () => { unsubscribe(); documents.stop(); };
  }, [documents, studio]);
  useEffect(() => { setOffset(0); void documents.load(selectedTableId); }, [documents, selectedTableId]);
  const edit = (update: (table: Table) => Table) => documents.edit(selectedTableId, update);
  const blocked = draft?.status === 'conflict' || draft?.status === 'saving';
  const change = (index: number, column: string, value: string | number | boolean | null) => edit(current => ({ ...current, rows: current.rows.map((row, i) => i === index ? { ...row, [column]: value } : row) }));
  return <section className="table-pane"><div className="table-top"><div><span className="section-kicker">STUDIO FIXTURE</span><h2>{table?.definition?.name ?? selectedTableId} <span>{table?.rows.length || 0} rows</span></h2><p>Changes are saved to Studio data and reflected in the preview.</p></div><div className="table-actions"><button onClick={onImport}>Import CSV / XLSX</button><button onClick={() => void documents.save(selectedTableId, true)} disabled={!table || blocked}>Convert to {table?.format === 'csv' ? 'XLSX' : 'CSV'}</button><button className="primary-small" onClick={() => void documents.save(selectedTableId)} disabled={!table || blocked}><Check size={14} /> {draft?.status === 'saving' ? 'Saving…' : draft?.status === 'error' ? 'Retry save' : 'Save table'}</button></div></div>
    {draft?.status === 'conflict' && <div className="draft-recovery" role="alert"><span>{draft.requiresReopen ? 'Another tab changed this workspace. Copy drafts before reopening.' : !acceptedPath ? 'Accepted table deleted. Your draft is retained.' : 'Accepted table changed. Your draft is retained.'}</span><button onClick={() => void navigator.clipboard.writeText(documents.copy(selectedTableId)).catch(studio.report)}>Copy draft</button><button onClick={() => draft.requiresReopen ? window.location.reload() : void documents.reload(selectedTableId)}>{draft.requiresReopen ? 'Reopen studio' : !acceptedPath ? 'Discard draft' : 'Reload accepted'}</button></div>}
    {draft?.status === 'error' && <div className="draft-recovery" role="alert">Unsaved: {draft.error}</div>}{draft?.status === 'dirty' && <div className="draft-recovery" role="status">Unsaved changes</div>}
    {table ? <><div className="fixture-generator"><span>Generate rows</span><label>Seed <input type="number" value={generationSeed} onChange={e => setGenerationSeed(Number(e.target.value))} /></label><label>Count <input type="number" min="1" max="100" value={generationCount} onChange={e => setGenerationCount(Number(e.target.value))} /></label><button onClick={() => edit(current => { const rows = generateRows(current, generationSeed, generationCount); return { ...current, rows, handles: rows.map(() => crypto.randomUUID()) }; })}>Generate</button><small>Preview first, then save.</small></div>
      <div className="table-scroll"><table><thead><tr>{table.columns.map(column => <th key={column}>{column}<small> {table.definition?.fields.find(f => f.name === column)?.type}</small></th>)}<th /></tr></thead><tbody>{table.rows.slice(offset, offset + 100).map((row, local) => {
        const index = offset + local;
        return <tr key={table.handles?.[index] ?? index}>{table.columns.map(column => {
          const field = table.definition?.fields.find(f => f.name === column), nullable = field?.nullable, isNull = row[column] === null;
          return <td key={column}>{field?.type === 'boolean' ? <input aria-label={`${column} row ${index + 1}`} disabled={field.writable === false || isNull} type="checkbox" checked={row[column] === true} onChange={e => change(index, column, e.target.checked)} /> : field?.type === 'number' ? <NumberCell value={row[column]} label={`${column} row ${index + 1}`} disabled={field.writable === false || isNull} onChange={value => change(index, column, value)} /> : <input aria-label={`${column} row ${index + 1}`} disabled={field?.writable === false || isNull} placeholder={isNull ? 'null' : undefined} value={String(row[column] ?? '')} onChange={e => change(index, column, e.target.value)} />}
            {nullable && field?.writable !== false && <button aria-label={`${column} row ${index + 1} ${isNull ? 'set value' : 'set null'}`} onClick={() => change(index, column, isNull ? defaultValue({ ...field!, nullable: false }) : null)}>{isNull ? 'Value' : 'Null'}</button>}</td>;
        })}<td><button className="row-delete" aria-label={`Delete row ${index + 1}`} onClick={() => edit(current => ({ ...current, rows: current.rows.filter((_, i) => i !== index), handles: current.handles?.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></td></tr>;
      })}</tbody></table></div>
      {table.rows.length > 100 && <div><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous rows</button><span> {offset + 1}–{Math.min(offset + 100, table.rows.length)} </span><button disabled={offset + 100 >= table.rows.length} onClick={() => setOffset(offset + 100)}>Next rows</button></div>}
      <button className="add-row" onClick={() => edit(current => ({ ...current, rows: [...current.rows, Object.fromEntries((current.definition?.fields ?? []).map(f => [f.name, defaultValue(f)]))], handles: [...(current.handles ?? []), crypto.randomUUID()] }))}><Plus size={15} /> Add row</button>
    </> : <div className="table-empty">No `{selectedTableId}` studio fixture.</div>}
  </section>;
});
