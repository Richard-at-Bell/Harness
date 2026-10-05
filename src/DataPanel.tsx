import { memo, useEffect, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useStore } from 'zustand';
import { TableDocuments } from './tableDocuments';
import { generateRows, type Table } from './fixtures';
import { useGeneration, useStudio } from './studioContext';

export const DataPanel = memo(function DataPanel({ selectedTableId, onImport }: { selectedTableId: string; onImport: () => void }) {
  const studio = useStudio();
  const generation = useGeneration();
  const [documents] = useState(() => new TableDocuments(() => studio.workspace.store.getState().fixtures, (table, baseline, convert) => studio.saveTable(table, baseline, generation, convert), studio.report));
  const draft = useStore(documents.store, state => state.drafts.get(selectedTableId));
  const [generationSeed, setGenerationSeed] = useState(42);
  const [generationCount, setGenerationCount] = useState(8);
  const table = draft?.table ?? null;
  useEffect(() => {
    documents.start();
    const unsubscribe = studio.workspace.store.subscribe(state => documents.observe(state.fixtures));
    return () => { unsubscribe(); documents.stop(); };
  }, [documents, studio]);
  useEffect(() => { void documents.load(selectedTableId); }, [documents, selectedTableId]);
  function setTable(update: (table: Table | null) => Table | null) {
    documents.edit(selectedTableId, table => update(table) ?? table);
  }
  const saveTable = () => void documents.save(selectedTableId);
  const convertTable = () => void documents.save(selectedTableId, true);
  const blocked = draft?.status === 'conflict' || draft?.status === 'saving';
  return <section className="table-pane"><div className="table-top"><div><span className="section-kicker">STUDIO FIXTURE</span><h2>{selectedTableId} <span>{table?.rows.length || 0} rows</span></h2><p>Changes are saved to Studio data and reflected in the preview.</p></div><div className="table-actions"><button onClick={() => onImport()}>Import CSV / XLSX</button><button onClick={convertTable} disabled={!table || blocked}>Convert to {table?.format === 'csv' ? 'XLSX' : 'CSV'}</button><button className="primary-small" onClick={saveTable} disabled={!table || blocked}><Check size={14} /> {draft?.status === 'saving' ? 'Saving…' : draft?.status === 'error' ? 'Retry save' : 'Save table'}</button></div></div>{draft?.status === 'conflict' && <div className="draft-recovery" role="alert"><span>{draft.requiresReopen ? 'Another tab changed this workspace. Copy drafts before reopening.' : 'Accepted table changed. Your draft is retained.'}</span><button onClick={() => void navigator.clipboard.writeText(documents.copy(selectedTableId)).catch(studio.report)}>Copy draft</button><button onClick={() => draft.requiresReopen ? window.location.reload() : void documents.reload(selectedTableId)}>{draft.requiresReopen ? 'Reopen studio' : 'Reload accepted'}</button></div>}{draft?.status === 'error' && <div className="draft-recovery" role="alert">Unsaved: {draft.error}</div>}{draft?.status === 'dirty' && <div className="draft-recovery" role="status">Unsaved changes</div>}{table ? <><div className="fixture-generator"><span>Generate rows</span><label>Seed <input type="number" value={generationSeed} onChange={event => setGenerationSeed(Number(event.target.value))} /></label><label>Count <input type="number" min="1" max="100" value={generationCount} onChange={event => setGenerationCount(Number(event.target.value))} /></label><button onClick={() => setTable(current => current && ({ ...current, rows: generateRows(current, generationSeed, generationCount) }))}>Generate</button><small>Preview first, then save.</small></div><div className="table-scroll"><table><thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}<th /></tr></thead><tbody>{table.rows.map((row, index) => <tr key={String(row.id || index)}>{table.columns.map(column => <td key={column}>{column === 'completed' ? <input type="checkbox" checked={Boolean(row[column])} onChange={event => setTable(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, [column]: event.target.checked } : item) }))} /> : <input value={String(row[column] ?? '')} onChange={event => setTable(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, [column]: event.target.value } : item) }))} />}</td>)}<td><button className="row-delete" onClick={() => setTable(current => current && ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><button className="add-row" onClick={() => setTable(current => current && ({ ...current, rows: [...current.rows, Object.fromEntries(current.columns.map(column => [column, column === 'id' ? crypto.randomUUID() : column === 'completed' ? false : column === 'created_at' ? new Date().toISOString() : '']))] }))}><Plus size={15} /> Add row</button></> : <div className="table-empty">No `{selectedTableId}` studio fixture.</div>}</section>;
});
