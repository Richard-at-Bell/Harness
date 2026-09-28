import Papa from 'papaparse';
import type { FileMap } from './workspace';
import { toBytes, toText } from './workspace';

export type Row = Record<string, string | number | boolean | null>;
export type Table = { path: string; columns: string[]; rows: Row[]; format: 'csv' | 'xlsx' };

export function fixtureIds(files: FileMap): string[] {
  return [...new Set([...files.keys()].map(path => /^fixtures\/([^/]+)\.(?:csv|xlsx)$/.exec(path)?.[1]).filter((id): id is string => Boolean(id)))].sort();
}

export function generateRows(table: Table, seed: number, count: number): Row[] {
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
  const titles = ['Plan the next step', 'Review the design', 'Send a project update', 'Organize the workspace', 'Check the details', 'Make time for a break', 'Prepare a first draft', 'Finish a small task', 'Write down an idea', 'Share the result'];
  return Array.from({ length: Math.max(1, Math.min(100, count)) }, (_, index) => {
    const row: Row = {};
    for (const column of table.columns) {
      if (column === 'id') row[column] = `row-${seed}-${index + 1}`;
      else if (column === 'title') row[column] = titles[Math.floor(random() * titles.length)];
      else if (column === 'completed') row[column] = random() < 0.3;
      else if (column.endsWith('_at') || column.endsWith('_date')) row[column] = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
      else row[column] = `${column.replaceAll('_', ' ')} ${index + 1}`;
    }
    return row;
  });
}

export function tablePath(files: FileMap, id: string): string | undefined {
  return [...files.keys()].find(path => path === `fixtures/${id}.csv` || path === `fixtures/${id}.xlsx`);
}

export async function readTable(files: FileMap, id: string): Promise<Table> {
  const path = tablePath(files, id);
  if (!path) throw new Error(`Table “${id}” was not found`);
  const bytes = files.get(path)!;
  if (path.endsWith('.csv')) {
    const parsed = Papa.parse<Record<string, string>>(toText(bytes), { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    const columns = parsed.meta.fields || [];
    return { path, columns, format: 'csv', rows: parsed.data.map(raw => Object.fromEntries(columns.map(column => [column, column === 'completed' ? raw[column] === 'true' : raw[column] ?? '']))) };
  }
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no worksheet');
  const columns = (sheet.getRow(1).values as unknown[]).slice(1).map(String).filter(Boolean);
  const rows: Row[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const record: Row = {};
    columns.forEach((column, index) => {
      const raw = row.getCell(index + 1).value;
      record[column] = raw instanceof Date ? raw.toISOString() : typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : raw == null ? null : String(raw);
    });
    rows.push(record);
  });
  return { path, columns, rows, format: 'xlsx' };
}

export async function tableBytes(table: Table): Promise<Uint8Array> {
  if (table.format === 'csv') {
    const csv = Papa.unparse({ fields: table.columns, data: table.rows.map(row => table.columns.map(column => row[column] ?? '')) }, { escapeFormulae: true, newline: '\n' });
    return toBytes(csv + '\n');
  }
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(table.columns);
  for (const row of table.rows) sheet.addRow(table.columns.map(column => row[column]));
  return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

export async function tableSeed(files: FileMap): Promise<Record<string, Row[]>> {
  const seed: Record<string, Row[]> = {};
  for (const path of files.keys()) {
    const match = /^fixtures\/([^/]+)\.(csv|xlsx)$/.exec(path);
    if (match) seed[match[1]] = (await readTable(files, match[1])).rows;
  }
  return seed;
}

export async function seedScript(files: FileMap): Promise<string> {
  return `window.__FIXTURE_SEED__ = ${JSON.stringify(await tableSeed(files)).replaceAll('<', '\\u003c')};`;
}
