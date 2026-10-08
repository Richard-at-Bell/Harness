/** Browser-only dataset model and validation. No persistence or provider dependencies. */
export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;
export type Field = {
  id: string; name: string; type: 'text' | 'number' | 'boolean' | 'datetime'; nullable: boolean;
  writable?: boolean; default?: Value | { generate: 'uuid' | 'now' };
  constraints?: { min?: number; max?: number; integer?: boolean; maxLength?: number; pattern?: string; values?: Value[] };
};
export type DatasetDefinition = {
  id: string; name: string; fields: Field[]; schemaRevision: number;
  rowIdentity?: string; schemaPolicy: 'grow' | 'fixed';
  blanks: 'escaped-null-v1'; provenance: { source: string; reference?: string; revision?: string };
};
export type DatasetMetadata = { version: 1; definition: DatasetDefinition; revision: number; handles: string[] };
export type Table = { path: string; columns: string[]; rows: Row[]; format: 'csv' | 'xlsx'; definition?: DatasetDefinition; revision?: number; handles?: string[]; metadataBytes?: Uint8Array };
export type Dataset = Table & { definition: DatasetDefinition; revision: number; handles: string[] };
/** Later bindings can reject schema growth or individual changes before bytes are written. */
export type DatasetPolicy = { validate?: (before: Dataset | undefined, after: Dataset) => void };
export type Mutation = { op: 'addFields'; fields: Omit<Field, 'id'>[]; patches?: { handle: string; values: Row }[] } | { op: 'insert'; row: Row } | { op: 'update'; handle: string; patch: Row } | { op: 'remove'; handle: string } | { op: 'replace'; rows: Row[]; handles?: string[] };

/** Self-contained factory: the same validation kernel is embedded in static exports. */
export function datasetKernel() {
  function validateDefinition(d: DatasetDefinition) {
    if (!d || typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 120 || /[\\/]/.test(d.name) || d.name === '.' || d.name === '..') throw new Error('Invalid dataset identity or name');
    if (!Number.isSafeInteger(d.schemaRevision) || d.schemaRevision < 1 || !['grow', 'fixed'].includes(d.schemaPolicy) || d.blanks !== 'escaped-null-v1' || typeof d.provenance?.source !== 'string') throw new Error('Invalid dataset contract');
    if (!Array.isArray(d.fields) || !d.fields.length) throw new Error('Dataset needs ordered fields');
    const ids = new Set<string>(), names = new Set<string>();
    for (const f of d.fields) {
      if (!f || typeof f.id !== 'string' || !f.id || typeof f.name !== 'string' || !f.name.trim() || ids.has(f.id) || names.has(f.name) || !['text','number','boolean','datetime'].includes(f.type) || typeof f.nullable !== 'boolean') throw new Error('Fields need unique identities, names, and declared types');
      if (['__proto__', 'constructor', 'prototype'].includes(f.name)) throw new Error('Reserved field name');
      ids.add(f.id); names.add(f.name);
      const c = f.constraints;
      if (c?.pattern) new RegExp(c.pattern);
      if (f.writable !== undefined && typeof f.writable !== 'boolean' || c?.min != null && c?.max != null && c.min > c.max || c?.integer !== undefined && typeof c.integer !== 'boolean' || c?.values !== undefined && !Array.isArray(c.values)) throw new Error('Invalid field permissions or constraints');
      if (c?.min != null && !Number.isFinite(c.min) || c?.max != null && !Number.isFinite(c.max) || c?.maxLength != null && (!Number.isSafeInteger(c.maxLength) || c.maxLength < 0)) throw new Error('Invalid field constraint');
      if (f.default !== undefined && (typeof f.default !== 'object' || f.default === null)) normalizeValue(f, f.default);
      else if (f.default && (!['uuid', 'now'].includes(f.default.generate) || (f.default.generate === 'uuid' ? f.type !== 'text' : !['text', 'datetime'].includes(f.type)))) throw new Error('Invalid generated default');
    }
    if (d.rowIdentity && !ids.has(d.rowIdentity)) throw new Error('Row identity must reference a field identity');
  }
  function numericPrecisionError(name: string): never {
    throw new Error(`Unsupported ${name} numeric precision: values must be finite, integers must be safe, and decimal digits must round-trip unchanged. Use a text field to retain exact digits.`);
  }
  function supportedNumber(value: number, name: string): number {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) numericPrecisionError(name);
    return value === 0 ? 0 : value; // The data contract normalizes negative zero.
  }
  function decimalIdentity(text: string): string {
    const [mantissa, exponent = '0'] = text.toLowerCase().split('e');
    const fraction = mantissa.split('.')[1]?.length ?? 0;
    const digits = mantissa.replace(/^-/, '').replace('.', '').replace(/^0+/, '');
    if (!digits) return '0';
    const significant = digits.replace(/0+$/, '');
    const scale = Number(exponent) - fraction + digits.length - significant.length;
    return (mantissa.startsWith('-') ? '-' : '') + significant + 'e' + scale;
  }
  /** Decimal/scientific wire text must survive binary64's canonical decimal rendering. */
  function decodeNumber(text: string, name: string): number {
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error(`Invalid ${name} number: use decimal/scientific notation, or a text field for literal text`);
    const value = supportedNumber(Number(text), name);
    if (decimalIdentity(text) !== decimalIdentity(String(value))) numericPrecisionError(name);
    return value;
  }
  function normalizeValue(field: Field, value: unknown): Value {
    const fail = () => { throw new Error(`Invalid ${field.name} value: expected ${field.type}${field.nullable ? ' or null' : ''}${field.type === 'number' ? '. Use a text field to retain exact digits when numeric precision is unsupported.' : ''}`); };
    if (value === null) { if (field.nullable) return null; return fail(); }
    if (field.type === 'number' ? typeof value !== 'number' : field.type === 'boolean' ? typeof value !== 'boolean' : typeof value !== 'string') return fail();
    if (field.type === 'number') value = supportedNumber(value as number, field.name);
    if (field.type === 'datetime') {
      // Require a timezone and millisecond precision at most; avoid calendar rollover.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value as string)) return fail();
      const text = value as string, date = new Date(text), local = new Date(text.slice(0,19) + 'Z');
      if (!Number.isFinite(date.getTime()) || local.toISOString().slice(0,19) !== text.slice(0,19)) return fail();
      value = date.toISOString();
    }
    const c = field.constraints;
    if (typeof value === 'number' && (c?.integer && !Number.isInteger(value) || c?.min != null && value < c.min || c?.max != null && value > c.max)) return fail();
    if (typeof value === 'string' && (c?.maxLength != null && value.length > c.maxLength || c?.pattern && !new RegExp(c.pattern).test(value))) return fail();
    if (c?.values && !c.values.includes(value as Value)) return fail();
    return value as Value;
  }
  function defaultValue(f: Field): Value {
    if (f.default !== undefined) return typeof f.default === 'object' && f.default !== null ? f.default.generate === 'uuid' ? crypto.randomUUID() : new Date().toISOString() : f.default;
    if (f.nullable) return null;
    if (f.type === 'text') return '';
    if (f.type === 'number') return 0;
    if (f.type === 'boolean') return false;
    return new Date().toISOString();
  }
  function normalizeRows(d: DatasetDefinition, rows: Row[]): Row[] {
    validateDefinition(d);
    if (!Array.isArray(rows) || rows.length > 100_000) throw new Error('Invalid or oversized dataset');
    const names = new Set(d.fields.map(f => f.name));
    const normalized = rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid row');
      for (const name of Object.keys(row)) if (!names.has(name)) throw new Error(`Undeclared field ${name}`);
      return Object.fromEntries(d.fields.map(f => [f.name, normalizeValue(f, Object.hasOwn(row, f.name) ? row[f.name] : defaultValue(f))]));
    });
    if (d.rowIdentity) {
      const field = d.fields.find(f => f.id === d.rowIdentity)!;
      const keys = normalized.map(row => row[field.name]);
      if (keys.some(key => key === null || key === '') || new Set(keys).size !== keys.length) throw new Error('Declared row identity must be nonblank and unique');
    }
    return normalized;
  }
  function inferField(name: string, values: Value[], id: string = crypto.randomUUID()): Field {
    const present = values.filter(v => v !== null && v !== undefined);
    const types = new Set(present.map(v => typeof v));
    if (types.size > 1 || [...types].some(t => !['string','number','boolean'].includes(t))) throw new Error(`Invalid ${name} value: mixed types require an explicit schema`);
    return { id, name, type: types.has('number') ? 'number' : types.has('boolean') ? 'boolean' : 'text', nullable: true };
  }
  function growDefinition(d: DatasetDefinition, rows: Row[]): DatasetDefinition {
    const extra = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(name => !d.fields.some(f => f.name === name));
    if (!extra.length) return d;
    if (d.schemaPolicy === 'fixed') throw new Error('Dataset schema policy forbids new fields');
    return { ...d, schemaRevision: d.schemaRevision + 1, fields: [...d.fields, ...extra.map(name => inferField(name, rows.map(row => row[name])))] };
  }
  function mutateDataset(before: Dataset, mutation: Mutation, expectedRevision: number, policy?: DatasetPolicy): Dataset {
    if (expectedRevision !== before.revision) throw new Error('Dataset revision changed; read again before retrying');
    const next = structuredClone(before);
    let changedRows: Row[] = [];
    if (mutation.op === 'addFields') {
      if (before.definition.schemaPolicy === 'fixed') throw new Error('Dataset schema policy forbids new fields');
      if (!Array.isArray(mutation.fields) || !mutation.fields.length) throw new Error('Declare added fields');
      const fields = mutation.fields.map(f => ({ ...f, id: crypto.randomUUID() }));
      next.definition = { ...next.definition, fields: [...next.definition.fields, ...fields], schemaRevision: next.definition.schemaRevision + 1 };
      // Only declared new fields may receive values in this schema operation.
      for (const patch of mutation.patches ?? []) {
        const index = next.handles.indexOf(patch.handle);
        if (index < 0 || Object.keys(patch.values).some(name => !fields.some(f => f.name === name))) throw new Error('Invalid schema values or row handle');
        next.rows[index] = { ...next.rows[index], ...patch.values };
      }
    } else if (mutation.op === 'insert') {
      for (const f of before.definition.fields) if (f.writable === false && Object.hasOwn(mutation.row, f.name)) throw new Error(`Field ${f.name} is read-only`);
      changedRows = [mutation.row]; next.rows.push(mutation.row); next.handles.push(crypto.randomUUID()); }
    else if (mutation.op === 'replace') { changedRows = mutation.rows; next.rows = mutation.rows; next.handles = mutation.handles ?? mutation.rows.map(() => crypto.randomUUID()); }
    else {
      const index = next.handles.indexOf(mutation.handle);
      if (index < 0) throw new Error('Row handle not found');
      if (mutation.op === 'remove') { next.rows.splice(index, 1); next.handles.splice(index, 1); }
      else {
        for (const f of before.definition.fields) if (f.writable === false && Object.hasOwn(mutation.patch, f.name) && mutation.patch[f.name] !== before.rows[index][f.name]) throw new Error(`Field ${f.name} is read-only`);
        const row = { ...next.rows[index], ...mutation.patch }; changedRows = [row]; next.rows[index] = row;
      }
    }
    next.definition = growDefinition(next.definition, changedRows);
    next.rows = normalizeRows(next.definition, next.rows);
    if (mutation.op === 'replace') for (const f of before.definition.fields.filter(f => f.writable === false)) {
      for (let i = 0; i < next.rows.length; i++) {
        const old = before.handles.indexOf(next.handles[i]);
        if (old < 0 || before.rows[old][f.name] !== next.rows[i][f.name]) throw new Error(`Field ${f.name} is read-only; use targeted edits`);
      }
    }
    if (next.handles.length !== next.rows.length || new Set(next.handles).size !== next.handles.length || next.handles.some(h => typeof h !== 'string' || !h)) throw new Error('Invalid row handles');
    next.columns = next.definition.fields.map(f => f.name); next.revision++;
    policy?.validate?.(before, next);
    return next;
  }
  function datasetMeaning(table: Dataset) {
    return { definition: table.definition, handles: table.handles, rows: normalizeRows(table.definition, table.rows) };
  }
  function compareDatasets(before: Dataset, after: Dataset) {
    return { schemaChanged: JSON.stringify(before.definition) !== JSON.stringify(after.definition), rowsChanged: JSON.stringify({ handles: before.handles, rows: before.rows }) !== JSON.stringify({ handles: after.handles, rows: after.rows }) };
  }

  function pageDataset(table: Dataset, offset = 0, limit = 100) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Use an offset >= 0 and a page limit from 1 to 1000');
    const header = { definition: table.definition, revision: table.revision, columns: table.columns, total: table.rows.length, offset };
    let size = JSON.stringify(header).length, end = offset;
    if (size > 200_000) throw new Error('Dataset definition exceeds page response limit');
    while (end < Math.min(offset + limit, table.rows.length)) {
      const additional = JSON.stringify(table.rows[end]).length + JSON.stringify(table.handles[end]).length + 2;
      if (size + additional > 200_000) { if (end === offset) throw new Error('One row exceeds page response limit'); break; }
      size += additional; end++;
    }
    return { ...header, nextOffset: end < table.rows.length ? end : null, rows: table.rows.slice(offset, end), handles: table.handles.slice(offset, end) };
  }
  function encodeCSVValue(field: Field, value: Value): Value {
    if (value === null) return field.type === 'text' ? '\\N' : '';
    return field.type === 'text' && /^[\\=+\-@\t\r]/.test(value as string) ? '\\' + value : value;
  }
  return { decodeNumber, pageDataset, validateDefinition, normalizeValue, defaultValue, normalizeRows, inferField, growDefinition, mutateDataset, datasetMeaning, compareDatasets, encodeCSVValue };
}
export const { decodeNumber, pageDataset, validateDefinition, normalizeValue, defaultValue, normalizeRows, inferField, growDefinition, mutateDataset, datasetMeaning, compareDatasets, encodeCSVValue } = datasetKernel();
