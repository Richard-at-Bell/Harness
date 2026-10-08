import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DatasetService, migrateDatasets } from './datasetService';
import { compareDatasets, datasetMeaning, type Field } from './datasets';
import { createTools, type runAgent } from './agent';
import { createAgentTurns } from './agentTurns';
import { readTable, metadataPath } from './fixtures';
import { importZip } from './export';
import { newStudioChat, toBytes, Workspace } from './workspace';
import { IndexedWorkspaceStorage, type StorageHooks } from './workspaceStorage';
import { StudioRuntime } from './studioRuntime';
import { TableDocuments } from './tableDocuments';

export const contractFields: Omit<Field, 'id'>[] = [
  { name: 'BusinessCode', type: 'text', nullable: false, constraints: { maxLength: 12 } },
  { name: 'Amount', type: 'number', nullable: false, constraints: { min: 0, max: 1000 } },
  { name: 'enabled', type: 'boolean', nullable: false },
  { name: 'activeText', type: 'text', nullable: false },
  { name: 'When', type: 'datetime', nullable: false },
  { name: 'Empty', type: 'text', nullable: false },
  { name: 'Optional', type: 'number', nullable: true },
  { name: 'Notes', type: 'text', nullable: false },
  { name: 'NullableText', type: 'text', nullable: true },
];
const row = { BusinessCode: '0007', Amount: 12.5, enabled: true, activeText: 'TRUE', When: '2026-10-07T12:00:00+02:00', Empty: '', Optional: null, Notes: '東京, "hello"\nworld', NullableText: null };
async function setup(hooks: StorageHooks = {}) {
  const storage = await IndexedWorkspaceStorage.connect(`datasets-${crypto.randomUUID()}`, hooks), chat = newStudioChat();
  await storage.initialize({ files: new Map([['index.html', toBytes('<h1>Project</h1>')]]), fixtures: new Map(), identity: crypto.randomUUID(), session: { version: 2, chats: [chat], activeChatId: chat.id }, review: true, selection: { file: 'index.html', tableId: 'JOBDATA', tab: 'data' } });
  const opened = (await storage.load())!, workspace = new Workspace(storage, opened.files, opened.fixtures, opened);
  const studio = new StudioRuntime(workspace, opened.session, true);
  return { storage, workspace, studio };
}
function toolCall(stage: ReturnType<Workspace['stage']>) {
  const tools = createTools(stage);
  return async (name: string, input: object) => tools.find(t => t.name === name)!.execute(name, input);
}
describe('shared typed dataset contract', () => {
  it('preserves identity, field contracts, casing, blank policy and normalized values through save, CSV/XLSX/CSV, durable reload and ZIP', async () => {
    const { studio, workspace, storage } = await setup();
    const created = await studio.datasets.create({ name: 'JOBDATA', fields: contractFields, rows: [row, { ...row, NullableText: '', Notes: '\\N' }, { ...row, Notes: '=literal', NullableText: '\\literal' }] });
    const expected = datasetMeaning(created);
    expect(created.rows[0].When).toBe('2026-10-07T10:00:00.000Z');
    expect(created.path).not.toContain('JOBDATA');
    let draft = await studio.datasets.read('JOBDATA');
    for (const convert of [false, true, true]) {
      await studio.saveTable(draft, workspace.fixtures.get(draft.path)!, studio.generation, convert);
      draft = await studio.datasets.read(created.definition.id);
      expect(datasetMeaning(draft)).toEqual(expected);
      expect(compareDatasets(created, draft)).toEqual({ schemaChanged: false, rowsChanged: false });
    }
    const loaded = (await storage.load())!, reopened = new Workspace(storage, loaded.files, loaded.fixtures, loaded);
    expect(datasetMeaning(await readTable(reopened.fixtures, 'JOBDATA'))).toEqual(expected);
    const imported = await importZip(await studio.exportProject());
    expect(datasetMeaning(await readTable(imported.fixtures, 'JOBDATA'))).toEqual(expected);
    expect(imported.files.has(metadataPath(draft.path))).toBe(false);
    studio.stop(); storage.close();
  });
  it('updates the second duplicate code using a handle, rejects stale and obsolete preview writes, and never adds id', async () => {
    const { studio, workspace, storage } = await setup();
    const created = await studio.datasets.create({ name: 'JOBDATA', fields: contractFields, rows: [row, row] });
    await studio.tableRequest(0, 'JOBDATA', 'update', { handle: created.handles[1], revision: created.revision, patch: { Amount: 20 } }, () => true);
    const saved = await studio.datasets.read('JOBDATA'), before = workspace.store.getState();
    expect(saved.rows.map(r => r.Amount)).toEqual([12.5, 20]); expect(saved.columns).not.toContain('id'); expect(saved.handles).toEqual(created.handles);
    await expect(studio.tableRequest(0, 'JOBDATA', 'update', { handle: created.handles[1], revision: created.revision, patch: { Amount: 30 } }, () => true)).rejects.toThrow('revision');
    await expect(studio.tableRequest(-1, 'JOBDATA', 'update', {}, () => true)).rejects.toThrow('earlier workspace');
    await expect(studio.tableRequest(0, 'JOBDATA', 'update', {}, () => false)).rejects.toThrow('Preview was replaced');
    expect(workspace.store.getState()).toBe(before); studio.stop(); storage.close();
  });
  it('keeps schema growth staged, accepts atomically, discards completely and retries a failed durable acceptance', async () => {
    const hooks: StorageHooks = {}, { studio, workspace, storage } = await setup(hooks);
    await studio.datasets.create({ name: 'JOBDATA', fields: contractFields, rows: [row, row] });
    const original = await studio.datasets.read('JOBDATA');
    const runner: typeof runAgent = async (_p, _k, _m, stage) => {
      const page = await new DatasetService({ fixtures: stage.fixtures, async writeFixture(p,b) { stage.writeFixtureBytes(p,b); }, async removeFixture(p) { stage.fixtures.delete(p); } }).page('JOBDATA');
      await toolCall(stage)('update_row', { table: 'JOBDATA', revision: page.revision, handle: page.handles[1], patch: { AddedField: true } });
      return { text: 'Controlled schema growth', messages: [] };
    };
    const turns = createAgentTurns({ workspace, session: studio.session, generation: () => studio.generation, transact: studio.transact, flash: () => {} }, runner);
    await turns.send('grow', 'controlled');
    const pending = studio.session.store.getState().pending!;
    expect(datasetMeaning(await studio.datasets.read('JOBDATA'))).toEqual(datasetMeaning(original));
    const staged = await readTable(pending.fixtures, 'JOBDATA');
    expect(staged.definition.schemaRevision).toBe(2); expect(staged.rows.map(r => r.AddedField)).toEqual([null, true]);
    expect(pending.paths.sort()).toEqual([original.path, metadataPath(original.path)].sort());
    turns.discard(); expect(datasetMeaning(await studio.datasets.read('JOBDATA'))).toEqual(datasetMeaning(original));
    await turns.send('grow', 'controlled'); const retained = studio.session.store.getState().pending;
    hooks.boundary = at => { if (at === 'activation') throw new Error('Injected typed commit failure'); };
    await expect(turns.accept()).rejects.toThrow('Injected typed commit failure');
    expect(studio.session.store.getState().pending).toBe(retained);
    expect(datasetMeaning(await readTable((await storage.load())!.fixtures, 'JOBDATA'))).toEqual(datasetMeaning(original));
    hooks.boundary = undefined; await turns.accept();
    const accepted = await studio.datasets.read('JOBDATA'); expect(accepted.rows.map(r => r.AddedField)).toEqual([null,true]);
    expect(accepted.definition.fields.slice(0, original.columns.length)).toEqual(original.definition.fields);
    expect(studio.session.store.getState().pending).toBeNull(); studio.stop(); storage.close();
  });
  it('retains typed drafts on failed saves, detects schema-only conflicts, and recovers on retry', async () => {
    const hooks: StorageHooks = {}, { studio, workspace, storage } = await setup(hooks);
    await studio.datasets.create({ name: 'JOBDATA', fields: contractFields, rows: [row] });
    const documents = new TableDocuments(() => workspace.fixtures, (t,b,c) => studio.saveTable(t,b,0,c), () => {});
    const off = workspace.store.subscribe(s => documents.observe(s.fixtures));
    await documents.load('JOBDATA'); documents.edit('JOBDATA', t => ({ ...t, rows: [{ ...t.rows[0], Amount: 99 }] }));
    const before = workspace.store.getState();
    hooks.boundary = at => { if (at === 'after-write') throw new Error('Injected save failure'); };
    await documents.save('JOBDATA'); expect(documents.store.getState().drafts.get('JOBDATA')?.status).toBe('error');
    expect(workspace.store.getState()).toBe(before); expect((await readTable((await storage.load())!.fixtures, 'JOBDATA')).rows[0].Amount).toBe(12.5);
    hooks.boundary = undefined; await documents.save('JOBDATA'); expect((await studio.datasets.read('JOBDATA')).rows[0].Amount).toBe(99);
    documents.edit('JOBDATA', t => ({ ...t, rows: [{ ...t.rows[0], Amount: 77 }] }));
    const current = await studio.datasets.read('JOBDATA');
    await workspace.writeFixture(metadataPath(current.path), toBytes(JSON.stringify({ version: 1, definition: { ...current.definition, provenance: { source: 'external', reference: 'generic-evidence' } }, revision: current.revision + 1, handles: current.handles })));
    expect(documents.store.getState().drafts.get('JOBDATA')?.status).toBe('conflict'); expect(documents.copy('JOBDATA')).toContain('77');
    off(); documents.stop(); studio.stop(); storage.close();
  });
  it('rejects wrong types, constraints, read-only updates and fixed schema growth without partial bytes', async () => {
    const { studio, workspace, storage } = await setup();
    const table = await studio.datasets.create({ name: 'Strict', fields: [{ name: 'Code', type: 'text', nullable: false, writable: false }, { name: 'Amount', type: 'number', nullable: false, constraints: { min: 0 } }], rows: [{ Code: '0007', Amount: 12.5 }], schemaPolicy: 'fixed' });
    const before = workspace.store.getState();
    for (const patch of [{ Amount: '12.5' }, { Amount: -1 }, { Code: '0008' }, { Added: true }]) {
      await expect(studio.tableRequest(0, 'Strict', 'update', { handle: table.handles[0], revision: table.revision, patch }, () => true)).rejects.toThrow();
      expect(workspace.store.getState()).toBe(before);
      const stage = workspace.stage(); await expect(toolCall(stage)('update_row', { table: 'Strict', revision: table.revision, handle: table.handles[0], patch })).rejects.toThrow(); expect(stage.changes()).toEqual([]);
    }
    studio.stop(); storage.close();
  });
  it('pages more than 1000 agent rows and targets one without dropping unread data', async () => {
    const { studio, workspace, storage } = await setup();
    const table = await studio.datasets.create({ name: 'Large', fields: [{ name: 'Code', type: 'text', nullable: false }, { name: 'Amount', type: 'number', nullable: false }], rows: Array.from({ length: 1505 }, (_, i) => ({ Code: '0007', Amount: i })) });
    const stage = workspace.stage(), call = toolCall(stage);
    const parse = (result: any) => JSON.parse(result.content[0].text);
    const page = parse(await call('read_table', { table: 'Large', offset: 1000, limit: 200 }));
    expect(page.total).toBe(1505); expect(page.rows).toHaveLength(200); expect(page.nextOffset).toBe(1200);
    await call('update_row', { table: 'Large', revision: page.revision, handle: page.handles[1], patch: { Amount: 9999 } });
    const saved = await readTable(stage.fixtures, 'Large'); expect(saved.rows).toHaveLength(1505);
    expect(saved.rows[1001].Amount).toBe(9999); expect(saved.rows[0]).toEqual(table.rows[0]); expect(saved.rows[1504]).toEqual(table.rows[1504]);
    await expect(call('write_table', { table: 'Large', revision: saved.revision, rows: page.rows })).rejects.toThrow('replaceAll');
    await expect(call('read_table', { table: 'Large', limit: 1001 })).rejects.toThrow('page limit');
    studio.stop(); storage.close();
  });
  it('migrates generic CSV as text and reference to-do defaults without losing case or escaped literals', async () => {
    const old = new Map([['fixtures/JOBDATA.csv', toBytes('Code,Flag,Empty\n0007,TRUE,\n')], ['fixtures/todos.csv', toBytes('id,title,completed,created_at\n1,Original,false,2026-10-07T12:00:00Z\n')]]);
    const migrated = await migrateDatasets(old), migratedAgain = await migrateDatasets(migrated);
    const job = await readTable(migrated, 'JOBDATA'); expect(job.rows[0]).toEqual({ Code: '0007', Flag: 'TRUE', Empty: '' }); expect(job.definition.fields.map(f => f.type)).toEqual(['text','text','text']);
    expect(migratedAgain).toEqual(migrated);
    const workspace = new Workspace((await import('./workspaceStorage')).memoryStorage({}), new Map(), migrated), chat = newStudioChat(), studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
    const inserted = await studio.tableRequest(0, 'todos', 'insert', { title: 'New task' }, () => true) as any;
    expect(inserted.id).toBeTruthy(); expect(inserted.completed).toBe(false); expect(inserted.created_at).toMatch(/Z$/);
    await studio.tableRequest(0, 'todos', 'update', { id: inserted.id, patch: { completed: true } }, () => true);
    await studio.tableRequest(0, 'todos', 'remove', { id: inserted.id }, () => true);
    expect((await studio.datasets.read('todos')).rows).toHaveLength(1); studio.stop();
  });
});

it('declares added fields and values atomically, honors an injected policy, and rejects oversized pages', async () => {
  const { studio, workspace, storage } = await setup();
  const initial = await studio.datasets.create({ name: 'Schema', fields: [{ name: 'Code', type: 'text', nullable: false }], rows: [{ Code: '0007' }, { Code: '0007' }] });
  const next = await studio.datasets.mutate('Schema', { op: 'addFields', fields: [{ name: 'Approved', type: 'boolean', nullable: true }], patches: [{ handle: initial.handles[1], values: { Approved: true } }] }, initial.revision);
  expect(next.rows.map(r => r.Approved)).toEqual([null,true]); expect(next.definition.fields[0]).toEqual(initial.definition.fields[0]);
  const before = workspace.store.getState();
  await expect(workspace.transaction(writer => new DatasetService(writer, { validate: () => { throw new Error('Generic binding policy rejected'); } }).mutate('Schema', { op: 'update', handle: next.handles[0], patch: { Approved: false } }, next.revision))).rejects.toThrow('Generic binding policy');
  expect(workspace.store.getState()).toBe(before);
  const large = await studio.datasets.create({ name: 'LongRows', fields: [{ name: 'Text', type: 'text', nullable: false }], rows: [{ Text: 'x'.repeat(210_000) }] });
  await expect(toolCall(workspace.stage())('read_table', { table: large.definition.id })).rejects.toThrow('response limit');
  studio.stop(); storage.close();
});

it('decodes explicit imports consistently, preserves case and identity, and rejects lossy workbook content', async () => {
  const { studio, workspace, storage } = await setup();
  const table = await studio.datasets.create({ name: 'JOBDATA', fields: contractFields, rows: [row] });
  const baseline = workspace.store.getState();
  const source = workspace.fixtures.get(table.path)!;
  await studio.importTable(new File([source as BlobPart], 'JOBDATA.csv'));
  const imported = await studio.datasets.read('JOBDATA'); expect(imported.definition).toEqual(table.definition); expect(imported.rows).toEqual(table.rows);
  await expect(studio.importTable(new File([toBytes('Wrong,Header\nx,y\n') as BlobPart], 'JOBDATA.csv'))).rejects.toThrow('header');
  expect((await studio.datasets.read('JOBDATA')).rows).toEqual(table.rows);
  const ExcelJS = await import('exceljs'), workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['Code']); sheet.addRow([{ formula: '1+1', result: 2 }]);
  const invalid = new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  await expect(studio.importTable(new File([invalid as BlobPart], 'FORMULA.xlsx'))).rejects.toThrow('Formula');
  const other = new Workspace((await import('./workspaceStorage')).memoryStorage({}), new Map());
  const importedDefinition = { ...table.definition, id: 'legacy:portable-contract' };
  const copy = await other.transaction(writer => new DatasetService(writer).import('JOBDATA', 'fixtures/JOBDATA.csv', source, importedDefinition));
  expect(copy.definition.id).toBe(importedDefinition.id); expect(copy.path).not.toContain('legacy:'); expect(copy.rows).toEqual(table.rows);
  expect(baseline.fixtures.get(table.path)).toEqual(source); studio.stop(); storage.close();
});

it('rolls back the entire automatic agent schema/data group on storage failure and catches a preview superseded during encoding', async () => {
  const hooks: StorageHooks = {}, { studio, workspace, storage } = await setup(hooks);
  const table = await studio.datasets.create({ name: 'JOBDATA', fields: contractFields, rows: [row], format: 'xlsx' });
  const before = workspace.store.getState(); let stageCaptured: ReturnType<Workspace['stage']> | undefined;
  const turns = createAgentTurns({ workspace, session: studio.session, generation: () => studio.generation, transact: studio.transact, flash: () => {} }, async (_p,_k,_m,stage,_prior,callbacks) => {
    stageCaptured = stage; await createTools(stage, callbacks).find(t => t.name === 'update_row')!.execute('controlled', { table: 'JOBDATA', revision: table.revision, handle: table.handles[0], patch: { Added: true } });
    return { text: 'Controlled', messages: [] };
  });
  studio.session.setReview(false); hooks.boundary = at => { if (at === 'before-activation') throw new Error('Automatic commit failure'); };
  await turns.send('grow', 'controlled'); expect(workspace.store.getState()).toBe(before); expect(stageCaptured!.changes()).toEqual([]);
  expect((await readTable((await storage.load())!.fixtures, 'JOBDATA')).columns).not.toContain('Added');
  hooks.boundary = undefined; await turns.send('grow', 'controlled'); expect((await studio.datasets.read('JOBDATA')).columns).toContain('Added');
  const accepted = workspace.store.getState(), revision = (await studio.datasets.read('JOBDATA')).revision;
  let checks = 0;
  await expect(studio.tableRequest(0, 'JOBDATA', 'update', { handle: table.handles[0], revision, patch: { Amount: 66 } }, () => ++checks < 3)).rejects.toThrow('Preview was replaced');
  expect(checks).toBe(3); expect(workspace.store.getState()).toBe(accepted); studio.stop(); storage.close();
});

it('uses explicit and existing schemas before interpreting todos imports, preserving text flags and the declared contract', async () => {
  const { studio, workspace, storage } = await setup();
  const table = await studio.datasets.create({ name: 'todos', fields: [
    { name: 'id', type: 'text', nullable: false },
    { name: 'title', type: 'text', nullable: false, constraints: { maxLength: 50 } },
    { name: 'completed', type: 'text', nullable: false, constraints: { values: ['TRUE', 'FALSE'] } },
    { name: 'created_at', type: 'datetime', nullable: false },
    { name: 'Amount', type: 'number', nullable: false, constraints: { min: 0, max: 100 } },
  ], rows: [
    { id: 'one', title: 'Text flag', completed: 'FALSE', created_at: '2026-10-07T12:00:00Z', Amount: 12.5 },
    { id: 'two', title: 'Other flag', completed: 'TRUE', created_at: '2026-10-07T12:00:00Z', Amount: 20 },
  ] });
  const { tableBytes } = await import('./fixtures');
  const { memoryStorage } = await import('./workspaceStorage');
  try {
    for (const format of ['csv', 'xlsx'] as const) {
      const path = `fixtures/todos.${format}`, bytes = await tableBytes({ ...table, path, format });
      const fresh = new Workspace(memoryStorage({}), new Map());
      const explicit = await fresh.transaction(writer => new DatasetService(writer).import('todos', path, bytes, table.definition));
      expect(explicit.definition).toEqual(table.definition); expect(explicit.rows).toEqual(table.rows);
      await studio.importTable(new File([bytes as BlobPart], `todos.${format}`));
      const existing = await studio.datasets.read('todos');
      expect(existing.definition).toEqual(table.definition); expect(existing.columns).toEqual(table.columns); expect(existing.rows).toEqual(table.rows);
      const before = workspace.store.getState();
      const wrongType = await tableBytes({ path, format, columns: table.columns, rows: [{ ...table.rows[0], Amount: 'bad' }], definition: { ...table.definition, fields: table.definition.fields.map(f => f.name === 'Amount' ? { ...f, type: 'text', constraints: undefined } : f) } });
      await expect(studio.importTable(new File([wrongType as BlobPart], `todos.${format}`))).rejects.toThrow(/Amount/);
      expect(workspace.store.getState()).toBe(before);
    }
    const before = workspace.store.getState();
    await expect(studio.importTable(new File(['ID,title,completed,created_at,Amount\none,Text,FALSE,2026-10-07T12:00:00Z,12.5\n'], 'todos.csv'))).rejects.toThrow('header');
    expect(workspace.store.getState()).toBe(before);
  } finally { studio.stop(); storage.close(); }
});
