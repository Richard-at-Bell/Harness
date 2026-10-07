import { datasetMeaning, growDefinition, mutateDataset, normalizeRows, validateDefinition, type Dataset, type DatasetDefinition, type DatasetPolicy, type Field, type Mutation, type Row } from './datasets';
import { fixtureIds, metadataBytes, metadataPath, readTable, tableBytes, tablePath } from './fixtures';
import { copyFiles, sameBytes, type FileMap, type FileSnapshot } from './workspace';
export type DatasetWriter = { readonly fixtures: FileSnapshot; writeFixture(path: string, bytes: Uint8Array): Promise<void>; removeFixture(path: string): Promise<void> };
export type CreateDataset = { name: string; fields: Omit<Field, 'id'>[]; rows?: Row[]; format?: 'csv' | 'xlsx'; schemaPolicy?: 'grow' | 'fixed'; rowIdentity?: string; provenance?: DatasetDefinition['provenance'] };
/** Operates inside Workspace's queue or on an isolated Stage. Never owns accepted state. */
export class DatasetService {
  constructor(private readonly writer: DatasetWriter, private readonly policy?: DatasetPolicy) {}
  read(name: string) { return readTable(this.writer.fixtures, name); }
  async page(name: string, offset = 0, limit = 100) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Use an offset >= 0 and a page limit from 1 to 1000');
    const table = await this.read(name), end = Math.min(offset + limit, table.rows.length);
    return { definition: table.definition, revision: table.revision, columns: table.columns, total: table.rows.length, offset, nextOffset: end < table.rows.length ? end : null, rows: table.rows.slice(offset, end), handles: table.handles.slice(offset, end) };
  }
  async create(input: CreateDataset) {
    if (fixtureIds(this.writer.fixtures).includes(input.name)) throw new Error(`Table “${input.name}” already exists`);
    const id = crypto.randomUUID(), format = input.format ?? 'csv';
    if (!['csv','xlsx'].includes(format)) throw new Error('Fixture format must be csv or xlsx');
    const fields = input.fields.map(f => ({ ...f, id: crypto.randomUUID() }));
    let definition: DatasetDefinition = { id, name: input.name, fields, schemaRevision: 1, schemaPolicy: input.schemaPolicy ?? 'grow', blanks: 'escaped-null-v1', provenance: input.provenance ?? { source: 'authored' }, rowIdentity: input.rowIdentity ? fields.find(f => f.name === input.rowIdentity)?.id : undefined };
    if (input.rowIdentity && !definition.rowIdentity) throw new Error('Unknown identity field');
    validateDefinition(definition);
    const rows = input.rows ?? []; definition = growDefinition(definition, rows);
    const dataset: Dataset = { path: `fixtures/${id}.${format}`, format, columns: definition.fields.map(f => f.name), rows: normalizeRows(definition, rows), definition, handles: rows.map(() => crypto.randomUUID()), revision: 1 };
    this.policy?.validate?.(undefined, dataset); return this.persist(dataset);
  }
  async persist(table: Dataset, oldPath?: string, isCurrent: () => boolean = () => true) {
    // All validation and encoding complete before touching the writer. The owner
    // publishes this entire group only after its durable transaction succeeds.
    const bytes = await tableBytes(table), meta = metadataBytes(table);
    if (!isCurrent()) throw new Error('Preview was replaced');
    await this.writer.writeFixture(table.path, bytes); await this.writer.writeFixture(metadataPath(table.path), meta);
    if (oldPath && oldPath !== table.path) await this.writer.removeFixture(oldPath);
    return { ...table, metadataBytes: meta };
  }
  async mutate(name: string, mutation: Mutation, revision: number, isCurrent?: () => boolean) {
    const before = await this.read(name); return this.persist(mutateDataset(before, mutation, revision, this.policy), undefined, isCurrent);
  }
  async save(draft: Dataset, bytes: Uint8Array, convert: boolean) {
    if (!sameBytes(this.writer.fixtures.get(draft.path), bytes) || !sameBytes(this.writer.fixtures.get(metadataPath(draft.path)), draft.metadataBytes)) throw new Error('Accepted table changed. Your draft is retained.');
    const before = await this.read(draft.definition.id);
    const next = mutateDataset(before, { op: 'replace', rows: draft.rows, handles: draft.handles }, draft.revision, this.policy);
    if (convert) { next.format = draft.format === 'csv' ? 'xlsx' : 'csv'; next.path = draft.path.replace(/\.(csv|xlsx)$/, '.' + next.format); if (this.writer.fixtures.has(next.path)) throw new Error('Destination table changed'); }
    return this.persist(next, draft.path);
  }
  async import(name: string, path: string, bytes: Uint8Array, definition?: DatasetDefinition) {
    const original = tablePath(this.writer.fixtures, name);
    let incoming: Dataset;
    if (definition) {
      const raw = await readTable(new Map([[path, bytes]]), path.slice(9).replace(/\.(csv|xlsx)$/, ''));
      const handles = raw.rows.map(() => crypto.randomUUID());
      incoming = await readTable(new Map([[path, bytes], [metadataPath(path), metadataBytes({ ...raw, definition, handles, revision: 1 })]]), definition.id);
    } else incoming = await readTable(new Map([[path, bytes]]), name);
    if (original) {
      const before = await this.read(name);
      // Import into an existing dataset decodes its declared schema. No inference.
      incoming = await readTable(new Map([[path, bytes], [metadataPath(path), metadataBytes({ ...before, path, handles: incoming.rows.map(() => crypto.randomUUID()) })]]), before.definition.id);
      incoming.path = before.path.replace(/\.(csv|xlsx)$/, '.' + incoming.format); incoming.revision = before.revision + 1;
      this.policy?.validate?.(before, incoming);
      for (const f of before.definition.fields) if (f.writable === false) throw new Error(`Field ${f.name} is read-only; use targeted edits`);
    } else {
      incoming.definition = { ...incoming.definition, id: crypto.randomUUID(), name, provenance: { source: 'imported' } }; incoming.revision = 1;
      incoming.path = `fixtures/${incoming.definition.id}.${incoming.format}`;
      this.policy?.validate?.(undefined, incoming);
    }
    return this.persist(incoming, original);
  }
}
/** A pure snapshot migration used by workspace opening, reset and old ZIPs. */
export async function migrateDatasets(files: FileSnapshot): Promise<FileMap> {
  const migrated = copyFiles(files);
  const writer: DatasetWriter = { fixtures: migrated, async writeFixture(p, b) { migrated.set(p, b); }, async removeFixture(p) { migrated.delete(p); } };
  const service = new DatasetService(writer);
  const ids = new Set<string>(), names = new Set<string>();
  for (const path of [...files.keys()].filter(p => /\.(csv|xlsx)$/.test(p))) {
    const meta = files.get(metadataPath(path));
    const name = meta ? JSON.parse(new TextDecoder().decode(meta)).definition.id : path.slice(9).replace(/\.(csv|xlsx)$/, '');
    const dataset = await readTable(files, name);
    if (ids.has(dataset.definition.id) || names.has(dataset.definition.name)) throw new Error('Duplicate dataset identity or name');
    ids.add(dataset.definition.id); names.add(dataset.definition.name);
    if (!meta) {
      // Keep original bytes when attaching the contract is already lossless.
      const candidate = new Map(files); candidate.set(metadataPath(path), metadataBytes(dataset));
      let compatible = false;
      try { compatible = JSON.stringify(datasetMeaning(await readTable(candidate, dataset.definition.id))) === JSON.stringify(datasetMeaning(dataset)); } catch { }
      if (compatible) migrated.set(metadataPath(path), metadataBytes(dataset)); else await service.persist(dataset);
    }
  }
  for (const path of files.keys()) if (path.endsWith('.dataset.json') && !files.has(path.replace(/\.dataset\.json$/, '.csv')) && !files.has(path.replace(/\.dataset\.json$/, '.xlsx'))) throw new Error('Orphan dataset metadata');
  return migrated;
}
