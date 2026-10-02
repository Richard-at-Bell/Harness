import { useEffect, useState } from 'react';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { fixtureIds, readTable, tablePath } from './fixtures';
import { useWorkspace } from './studioContext';
export function DataList({ selected, onSelect, onImport }: { selected: string; onSelect: (id: string) => void; onImport: () => void }) {
  const tables = useWorkspace(useShallow(state => fixtureIds(state.fixtures).map(id => `${id}:${tablePath(state.fixtures, id)?.endsWith('.xlsx') ? 'XLSX' : 'CSV'}`)));
  const [path, bytes] = useWorkspace(useShallow(state => { const path = tablePath(state.fixtures, selected); return [path, path ? state.fixtures.get(path) : undefined] as const; }));
  const [count, setCount] = useState<{ bytes: typeof bytes; rows: number } | null>(null);
  useEffect(() => { let active = true; if (path && bytes) readTable(new Map([[path, bytes]]), selected).then(table => { if (active) setCount({ bytes, rows: table.rows.length }); }).catch(() => { if (active) setCount(null); }); return () => { active = false; }; }, [path, bytes, selected]);
  return <div className="data-list">{tables.map(table => { const [id, format] = table.split(':'); return <button key={id} className={`data-item ${selected === id ? 'selected' : ''}`} onClick={() => onSelect(id)}><span className="data-icon"><FileSpreadsheet size={16} /></span><span><strong>{id}</strong><small>{id === selected && count?.bytes === bytes ? `${count?.rows} rows · ${format}` : format}</small></span></button>; })}<button className="import-fixture" onClick={onImport}><Plus size={14} /> Import CSV / XLSX</button><p>Fixtures live in Studio and are included in the ZIP under studio/fixtures.</p></div>;
}
