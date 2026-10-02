import { memo, useEffect, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { generateRows, readTable, tablePath, type Table } from './fixtures';
import { useGeneration, useStudio, useWorkspace } from './studioContext';

export const DataPanel = memo(function DataPanel({ selectedTableId, onImport }: { selectedTableId: string; onImport: () => void }) {
  const studio = useStudio();
  const generation = useGeneration();
  const [path, bytes] = useWorkspace(useShallow(state => { const path = tablePath(state.fixtures, selectedTableId); return [path, path ? state.fixtures.get(path) : undefined] as const; }));
  const [draft, setDraft] = useState<{ id: string; generation: number; base: Uint8Array; table: Table } | null>(null);
  const [generationSeed, setGenerationSeed] = useState(42);
  const [generationCount, setGenerationCount] = useState(8);
  const table = draft?.id === selectedTableId && draft.generation === generation ? draft.table : null;
  // A published change reloads only this table's draft, matching the existing
  // lifecycle. In-flight parsing cannot replace a newer selection or generation.
  useEffect(() => {
    let active = true;
    setDraft(null);
    if (path && bytes) readTable(new Map([[path, bytes]]), selectedTableId).then(table => { if (active) setDraft({ id: selectedTableId, generation, base: bytes, table }); }).catch(() => { if (active) setDraft(null); });
    return () => { active = false; };
  }, [path, bytes, selectedTableId, generation]);
  function setTable(update: (table: Table | null) => Table | null) {
    setDraft(current => { if (!current || current.id !== selectedTableId || current.generation !== generation) return current; const table = update(current.table); return table ? { ...current, table } : null; });
  }
  const saveTable = async () => {
    if (!table || !draft) return;
    try { await studio.saveTable(table, draft.base, draft.generation); studio.flash('Studio fixture saved.'); } catch (error) { studio.report(error); }
  };
  const convertTable = async () => {
    if (!table || !draft) return;
    try { await studio.saveTable(table, draft.base, draft.generation, true); studio.flash(`Converted table to ${table.format === 'csv' ? 'XLSX' : 'CSV'}.`); } catch (error) { studio.report(error); }
  };
  return <section className="table-pane"><div className="table-top"><div><span className="section-kicker">STUDIO FIXTURE</span><h2>{selectedTableId} <span>{table?.rows.length || 0} rows</span></h2><p>Changes are saved to Studio data and reflected in the preview.</p></div><div className="table-actions"><button onClick={() => onImport()}>Import CSV / XLSX</button><button onClick={convertTable} disabled={!table}>Convert to {table?.format === 'csv' ? 'XLSX' : 'CSV'}</button><button className="primary-small" onClick={saveTable} disabled={!table}><Check size={14} /> Save table</button></div></div>{table ? <><div className="fixture-generator"><span>Generate rows</span><label>Seed <input type="number" value={generationSeed} onChange={event => setGenerationSeed(Number(event.target.value))} /></label><label>Count <input type="number" min="1" max="100" value={generationCount} onChange={event => setGenerationCount(Number(event.target.value))} /></label><button onClick={() => setTable(current => current && ({ ...current, rows: generateRows(current, generationSeed, generationCount) }))}>Generate</button><small>Preview first, then save.</small></div><div className="table-scroll"><table><thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}<th /></tr></thead><tbody>{table.rows.map((row, index) => <tr key={String(row.id || index)}>{table.columns.map(column => <td key={column}>{column === 'completed' ? <input type="checkbox" checked={Boolean(row[column])} onChange={event => setTable(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, [column]: event.target.checked } : item) }))} /> : <input value={String(row[column] ?? '')} onChange={event => setTable(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, [column]: event.target.value } : item) }))} />}</td>)}<td><button className="row-delete" onClick={() => setTable(current => current && ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><button className="add-row" onClick={() => setTable(current => current && ({ ...current, rows: [...current.rows, Object.fromEntries(current.columns.map(column => [column, column === 'id' ? crypto.randomUUID() : column === 'completed' ? false : column === 'created_at' ? new Date().toISOString() : '']))] }))}><Plus size={15} /> Add row</button></> : <div className="table-empty">No `{selectedTableId}` studio fixture.</div>}</section>;
});
