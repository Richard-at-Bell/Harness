import { describe, expect, it } from 'vitest';
import { TableDocuments } from './tableDocuments';
import { StudioRuntime } from './studioRuntime';
import { memoryStorage } from './workspaceStorage';
import { newStudioChat, toBytes, Workspace } from './workspace';
import { readTable } from './fixtures';

function setup(write?: () => Promise<void>) {
  const workspace = new Workspace(memoryStorage({ write }), new Map(), new Map([['fixtures/todos.csv', toBytes('id,title\n1,Original\n')], ['fixtures/other.csv', toBytes('id,title\n2,Other\n')]]));
  const chat = newStudioChat();
  const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
  const documents = new TableDocuments(() => workspace.store.getState().fixtures, (table, baseline, convert) => studio.saveTable(table, baseline, 0, convert), () => {});
  const unsubscribe = workspace.store.subscribe(state => documents.observe(state.fixtures));
  return { workspace, studio, documents, stop() { unsubscribe(); documents.stop(); studio.stop(); } };
}
const edit = (documents: TableDocuments, title: string) => documents.edit('todos', table => ({ ...table, rows: table.rows.map(row => ({ ...row, title })) }));
describe('parsed fixture draft ownership', () => {
  it('retains dirty rows across navigation and external changes, with explicit reload recovery', async () => {
    const { documents, studio, workspace, stop } = setup();
    await documents.load('todos'); edit(documents, 'My rows');
    await documents.load('other'); await documents.load('todos');
    expect(documents.store.getState().drafts.get('todos')?.table.rows[0].title).toBe('My rows');
    await studio.tableRequest(0, 'todos', 'insert', { id: 'preview', title: 'Preview' }, () => true);
    expect(documents.store.getState().drafts.get('todos')).toMatchObject({ dirty: true, status: 'conflict' });
    expect(documents.copy('todos')).toContain('My rows');
    await documents.save('todos');
    expect((await readTable(workspace.fixtures, 'todos')).rows.map(r => r.title)).toEqual(['Original', 'Preview']);
    await documents.reload('todos');
    expect(documents.store.getState().drafts.get('todos')?.table.rows).toHaveLength(2);
    expect(documents.store.getState().drafts.get('todos')?.status).toBe('clean'); stop();
  });
  it('retains edits made during a save and acknowledges only the captured request', async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(done => { release = done; }), started = new Promise<void>(done => { entered = done; });
    const { documents, workspace, stop } = setup(async () => { entered(); await gate; });
    await documents.load('todos'); edit(documents, 'Saving rows');
    const saving = documents.save('todos'); await started;
    edit(documents, 'Newer rows'); release(); await saving;
    expect((await readTable(workspace.fixtures, 'todos')).rows[0].title).toBe('Saving rows');
    expect(documents.store.getState().drafts.get('todos')).toMatchObject({ dirty: true, status: 'dirty' });
    expect(documents.store.getState().drafts.get('todos')?.table.rows[0].title).toBe('Newer rows');
    await documents.save('todos');
    expect(documents.store.getState().drafts.get('todos')?.status).toBe('clean'); stop();
  });
  it('retains a failed save for retry and treats owned conversion as acknowledgement', async () => {
    let fail = true;
    const { documents, workspace, stop } = setup(async () => { if (fail) throw new Error('Full'); });
    await documents.load('todos'); edit(documents, 'Recover');
    await documents.save('todos'); expect(documents.store.getState().drafts.get('todos')?.status).toBe('error');
    fail = false; await documents.save('todos');
    expect(documents.store.getState().drafts.get('todos')?.status).toBe('clean');
    await documents.save('todos', true);
    expect([...workspace.fixtures.keys()]).toContain('fixtures/todos.xlsx');
    expect(workspace.fixtures.has('fixtures/todos.csv')).toBe(false);
    expect(documents.store.getState().drafts.get('todos')?.status).toBe('clean'); stop();
  });
  it('preserves a dirty draft after its fixture is removed externally', async () => {
    const { documents, workspace, stop } = setup();
    await documents.load('todos'); edit(documents, 'Keep this');
    await workspace.removeFixture('fixtures/todos.csv');
    expect(documents.store.getState().drafts.get('todos')?.status).toBe('conflict');
    expect(documents.copy('todos')).toContain('Keep this');
    await documents.save('todos'); expect(workspace.fixtures.has('fixtures/todos.csv')).toBe(false); stop();
  });
});
