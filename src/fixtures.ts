import Papa from 'papaparse';
import type { FileSnapshot } from './workspace';
import { toBytes, toText } from './workspace';
import { datasetKernel, encodeCSVValue, defaultValue, inferField, normalizeRows, normalizeValue, validateDefinition, type Dataset, type DatasetDefinition, type DatasetMetadata, type Field, type Row, type Table, type Value } from './datasets';
export type { Row, Table, Dataset, DatasetDefinition, Field } from './datasets';

export const metadataPath = (path: string) => path.replace(/\.(csv|xlsx)$/, '.dataset.json');
export function definitions(files: FileSnapshot): DatasetMetadata[] {
  return [...files].filter(([p]) => p.endsWith('.dataset.json')).map(([, bytes]) => {
    const m = JSON.parse(toText(bytes)) as DatasetMetadata;
    if (m.version !== 1 || !Number.isSafeInteger(m.revision) || m.revision < 0 || !Array.isArray(m.handles) || m.handles.some(h => typeof h !== 'string' || !h) || new Set(m.handles).size !== m.handles.length) throw new Error('Invalid dataset metadata');
    validateDefinition(m.definition); return m;
  });
}
export function fixtureIds(files: FileSnapshot): string[] {
  return [...new Set([...files.keys()].filter(p => /\.(csv|xlsx)$/.test(p)).map(path => {
    const meta = files.get(metadataPath(path));
    return meta ? (JSON.parse(toText(meta)) as DatasetMetadata).definition.name : /^fixtures\/([^/]+)\./.exec(path)![1];
  }))].sort();
}
export function tablePath(files: FileSnapshot, id: string): string | undefined {
  return [...files.keys()].find(path => {
    if (!/^fixtures\/[^/]+\.(csv|xlsx)$/.test(path)) return false;
    const meta = files.get(metadataPath(path));
    if (meta) { const { definition } = JSON.parse(toText(meta)) as DatasetMetadata; return definition.id === id || definition.name === id; }
    const legacy = id.startsWith('legacy:') ? id.slice(7) : id;
    return path === `fixtures/${legacy}.csv` || path === `fixtures/${legacy}.xlsx`;
  });
}
export function generateRows(table: Table, seed: number, count: number): Row[] {
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  const fields = table.definition?.fields ?? table.columns.map(name => inferField(name, table.rows.map(r => r[name])));
  return Array.from({ length: Math.max(1, Math.min(100, count)) }, (_, i) => Object.fromEntries(fields.map(f => [f.name,
    f.type === 'boolean' ? random() < .5 : f.type === 'number' ? Math.round(random() * 100) : f.type === 'datetime' ? new Date(Date.UTC(2026,0,1+i)).toISOString() : `${f.name} ${seed}-${i+1}`])));
}
async function cells(bytes: Uint8Array, format: 'csv' | 'xlsx', count?: number): Promise<{ columns: string[]; rows: unknown[][] }> {
  if (format === 'csv') {
    const parsed = Papa.parse<string[]>(toText(bytes), { skipEmptyLines: false, delimiter: ',' });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    const data = parsed.data;
    if (data.at(-1)?.length === 1 && data.at(-1)?.[0] === '') data.pop();
    const columns = data.shift() ?? [];
    if (!columns.length || columns.some(c => !c.trim()) || new Set(columns).size !== columns.length) throw new Error('Invalid fixture columns');
    if (data.some(row => row.length !== columns.length)) throw new Error('CSV row width does not match declared columns');
    return { columns, rows: data };
  }
  const ExcelJS = await import('exceljs'); const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as any); const sheet = workbook.worksheets[0];
  if (!sheet || workbook.worksheets.length !== 1) throw new Error('Workbook must contain exactly one data worksheet');
  const columns = (sheet.getRow(1).values as unknown[]).slice(1).map(v => typeof v === 'string' ? v : '');
  if (!columns.length || columns.some(c => !c.trim()) || new Set(columns).size !== columns.length) throw new Error('Invalid fixture columns');
  const rows: unknown[][] = [];
  if (count != null && sheet.rowCount > count + 1) throw new Error('Workbook row count does not match metadata');
  for (let i = 2; i <= (count != null ? count + 1 : sheet.rowCount); i++) {
    const row = sheet.getRow(i);
    if (row.cellCount > columns.length) throw new Error('Workbook row width exceeds declared columns');
    rows.push(columns.map((_, n) => {
      const v = row.getCell(n + 1).value;
      if (v instanceof Date) return v.toISOString();
      if (v == null || ['string','number','boolean'].includes(typeof v)) return v;
      throw new Error('Formula, rich text, and object cells need an explicit import conversion');
    }));
  }
  return { columns, rows };
}
function decode(f: Field, raw: unknown): Value {
  if (raw === '\\N') return normalizeValue(f, null);
  if (f.type === 'text') {
    if (raw != null && typeof raw !== 'string') throw new Error(`Lossy ${f.name} conversion to text; provide an explicit import schema`);
    const text = raw ?? ''; return normalizeValue(f, (text as string).startsWith('\\') ? (text as string).slice(1) : text);
  }
  if (raw === '' || raw == null) return normalizeValue(f, null);
  if (f.type === 'number' && typeof raw === 'string') {
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error(`Invalid ${f.name} number`);
    return normalizeValue(f, Number(raw));
  }
  if (f.type === 'boolean' && typeof raw === 'string') {
    if (!['true','false'].includes(raw)) throw new Error(`Invalid ${f.name} boolean`);
    return normalizeValue(f, raw === 'true');
  }
  return normalizeValue(f, raw);
}
/** Only legacy migration knows about the reference template. Generic CSV is text. */
function legacyDefinition(name: string, columns: string[], rows: Row[]): DatasetDefinition {
  const todo = name === 'todos' && columns.includes('id') && columns.includes('title') && columns.includes('completed');
  const fields = columns.map((name, i) => {
    const field = inferField(name, rows.map(r => r[name]), `legacy-field-${i}`);
    if (todo && name === 'completed') { field.type = 'boolean'; field.nullable = false; field.default = false; }
    if (todo && name === 'id') { field.type = 'text'; field.nullable = false; field.default = { generate: 'uuid' }; }
    if (todo && name === 'title') { field.type = 'text'; field.nullable = false; field.default = ''; }
    if (todo && name === 'created_at') { field.type = 'datetime'; field.nullable = false; field.default = { generate: 'now' }; }
    return field;
  });
  const identity = fields.find(f => f.name === 'id');
  const unique = identity && rows.every(r => r.id != null && r.id !== '') && new Set(rows.map(r => r.id)).size === rows.length;
  if (unique && identity && identity.type === 'text') identity.default = { generate: 'uuid' };
  return { id: `legacy:${name}`, name, fields, rowIdentity: unique ? identity?.id : undefined, schemaRevision: 1, schemaPolicy: 'grow', blanks: 'escaped-null-v1', provenance: { source: 'legacy' } };
}
export async function readTable(files: FileSnapshot, id: string): Promise<Dataset> {
  const path = tablePath(files, id); if (!path) throw new Error(`Table “${id}” was not found`);
  const format = path.endsWith('.csv') ? 'csv' : 'xlsx';
  const metadataBytes = files.get(metadataPath(path));
  const meta = metadataBytes ? JSON.parse(toText(metadataBytes)) as DatasetMetadata : undefined;
  if (meta) { definitions(new Map([[metadataPath(path), metadataBytes!]])); }
  const parsed = await cells(files.get(path)!, format, meta?.handles.length);
  let definition: DatasetDefinition, rows: Row[], handles: string[], revision: number;
  if (meta) {
    definition = meta.definition;
    if (JSON.stringify(parsed.columns) !== JSON.stringify(definition.fields.map(f => f.name))) throw new Error('Fixture header does not match declared schema');
    rows = parsed.rows.map(row => Object.fromEntries(definition.fields.map((f, i) => [f.name, decode(f, row[i])])));
    handles = meta.handles; revision = meta.revision;
    if (handles.length !== rows.length) throw new Error('Dataset row count does not match handles');
  } else {
    const name = /^fixtures\/([^/]+)\./.exec(path)![1];
    rows = parsed.rows.map(row => Object.fromEntries(parsed.columns.map((c, i) => [c, (row[i] ?? (format === 'csv' ? '' : null)) as Value])));
    const todo = name === 'todos' && parsed.columns.includes('title') && parsed.columns.includes('completed');
    if (todo) for (const row of rows) if (typeof row.completed === 'string') {
      if (!['true', 'false'].includes(row.completed)) throw new Error('Invalid completed value'); row.completed = row.completed === 'true';
    }
    definition = legacyDefinition(name, parsed.columns, rows); handles = rows.map((_, i) => `${definition.id}:row:${i}`); revision = 0;
  }
  return { path, format, columns: parsed.columns, rows: normalizeRows(definition, rows), definition, handles, revision, metadataBytes };
}
export async function tableBytes(table: Table): Promise<Uint8Array> {
  let definition = table.definition;
  if (!definition) {
    const columns = [...new Set([...table.columns, ...table.rows.flatMap(r => Object.keys(r))])];
    definition = legacyDefinition(/^fixtures\/([^/]+)\./.exec(table.path)?.[1] ?? 'data', columns, table.rows);
  }
  const rows = normalizeRows(definition, table.rows), columns = definition.fields.map(f => f.name);
  const encode = (row: Row) => definition!.fields.map(f => row[f.name] === null ? (f.type === 'text' ? '\\N' : null) : f.type === 'text' && table.definition ? encodeCSVValue(f, row[f.name]) : row[f.name]);
  if (table.format === 'csv') {
    const csv = Papa.unparse({ fields: columns, data: rows.map(encode) }, { newline: '\n', quotes: true });
    return toBytes((rows.length ? csv : csv.trimEnd()) + '\n');
  }
  const ExcelJS = await import('exceljs'); const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Data');
  sheet.addRow(columns); for (const row of rows) sheet.addRow(encode(row));
  return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}
export function metadataBytes(table: Dataset): Uint8Array {
  return toBytes(JSON.stringify({ version: 1, definition: table.definition, revision: table.revision, handles: table.handles } satisfies DatasetMetadata));
}
export async function tableSeed(files: FileSnapshot): Promise<Record<string, Row[]>> {
  return Object.fromEntries(await Promise.all(fixtureIds(files).map(async id => [id, (await readTable(files, id)).rows])));
}
export async function seedScript(files: FileSnapshot): Promise<string> {
  const datasets = await Promise.all(fixtureIds(files).map(id => readTable(files, id)));
  return `window.__DATASET_KERNEL__ = (${datasetKernel.toString()})();\nwindow.__FIXTURE_SEED__ = ${JSON.stringify(Object.fromEntries(datasets.map(d => [d.definition.name, d.rows]))).replaceAll('<', '\\u003c')};\nwindow.__DATASET_SEED__ = ${JSON.stringify(Object.fromEntries(datasets.map(d => [d.definition.name, { definition: d.definition, revision: d.revision, handles: d.handles }]))).replaceAll('<', '\\u003c')};`;
}
export { defaultValue };
