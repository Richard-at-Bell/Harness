import { memoryStorage } from './workspaceStorage';
import { describe, expect, it } from 'vitest';
import { StudioRuntime } from './studioRuntime';
import { readTable } from './fixtures';
import { importZip } from './export';
import { templateFiles } from './template';
import { newStudioChat, toBytes, Workspace } from './workspace';

function setup() {
  const workspace = new Workspace(memoryStorage({ write: async () => {}, remove: async () => {} }), new Map([['index.html', toBytes('Project')]]), new Map([['fixtures/todos.csv', toBytes('id,title\n1,Original\n')]]));
  const chat = newStudioChat();
  return new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
}

describe('fixture operation boundaries', () => {
  it('serializes preview mutations with table draft saves and rejects a stale draft', async () => {
    const studio = setup();
    const draft = await readTable(studio.workspace.fixtures, 'todos');
    const base = studio.workspace.fixtures.get(draft.path)!;
    draft.rows[0].title = 'Draft';
    const insert = studio.tableRequest(0, 'todos', 'insert', { id: '2', title: 'Preview' }, () => true);
    const saving = studio.saveTable(draft, base, 0);
    await insert;
    await expect(saving).rejects.toThrow('table changed');
    const rows = (await readTable(studio.workspace.fixtures, 'todos')).rows;
    expect(rows.map(row => row.title)).toEqual(['Original', 'Preview']);
    studio.stop();
  });

  it('rejects an old preview request at execution, and prevents callbacks from a replaced preview', async () => {
    const studio = setup();
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const blocker = studio.workspace.transaction(async () => { await gate; });
    const request = studio.tableRequest(0, 'todos', 'insert', { id: '2' }, () => true);
    studio.stop(); release(); await blocker;
    await expect(request).rejects.toThrow('earlier workspace');
    expect((await readTable(studio.workspace.fixtures, 'todos')).rows).toHaveLength(1);
    const current = setup();
    await expect(current.tableRequest(0, 'todos', 'insert', { id: '2' }, () => false)).rejects.toThrow('Preview was replaced');
    current.stop();
  });

  it('publishes a single coherent conversion and preserves both schema and rows', async () => {
    const studio = setup();
    const table = await readTable(studio.workspace.fixtures, 'todos');
    const observed: string[][] = [];
    studio.workspace.store.subscribe(state => { observed.push([...state.fixtures.keys()]); });
    await studio.saveTable(table, studio.workspace.fixtures.get(table.path)!, 0, true);
    expect(observed).toEqual([['fixtures/todos.xlsx']]);
    expect((await readTable(studio.workspace.fixtures, 'todos')).rows).toEqual(table.rows);
    studio.stop();
  });
});


describe('workspace replacement and export context', () => {
  it('rejects a save submitted by an editor from an earlier generation', async () => {
    const studio = setup();
    const editorGeneration = studio.generation;
    await studio.resetProject();
    await expect(studio.saveFile('app.js', 'old editor buffer', editorGeneration)).rejects.toThrow('earlier workspace');
    expect(studio.workspace.text('app.js')).toBe(templateFiles['app.js']);
    studio.stop();
  });
  it('invalidates queued old requests at the reset boundary', async () => {
    const studio = setup();
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const blocker = studio.workspace.transaction(async () => { await gate; });
    const resetting = studio.resetProject();
    await Promise.resolve();
    const stale = studio.tableRequest(0, 'todos', 'insert', { id: 'stale' }, () => true);
    const rejection = expect(stale).rejects.toThrow('replacement is committing');
    release(); await blocker;
    expect(await resetting).toBe(1);
    await rejection;
    expect(studio.workspace.text('app.js')).toBe(templateFiles['app.js']);
    expect((await readTable(studio.workspace.fixtures, 'todos')).rows.some(row => row.id === 'stale')).toBe(false);
    studio.stop();
  });

  it('exports accepted data and imports reused chat IDs without reviving an old turn', async () => {
    const studio = setup();
    const turn = studio.session.begin('Staged edit', 0)!;
    const stage = studio.workspace.stage(); stage.write('index.html', 'Pending');
    studio.session.finish(turn, stage);
    const archive = await studio.exportProject();
    expect(new TextDecoder().decode((await importZip(archive)).files.get('index.html'))).toBe('Project');
    const result = await studio.importProject(new File([archive], 'test.zip'));
    expect(result.generation).toBe(1);
    expect(studio.session.store.getState().activeChatId).toBe(turn.chatId);
    studio.session.text(turn, 'Old callback');
    expect(studio.session.store.getState().chats[0].chat.at(-1)?.text).not.toBe('Old callback');
    expect(studio.session.store.getState().pending).toBeNull();
    studio.stop();
  });
});


describe('replacement lifecycle', () => {
  it('permits work during preparation, gates commit and publishes identity with new contents', async () => {
    let prepared!: () => void, durable!: () => void, entered!: () => void;
    const preparing = new Promise<void>(done => { prepared = done; });
    const writing = new Promise<void>(done => { durable = done; });
    const committing = new Promise<void>(done => { entered = done; });
    let block = false;
    const workspace = new Workspace(memoryStorage({ write: async () => { if (block) { entered(); await writing; } } }), new Map([['old.js', toBytes('old')]]));
    const chat = newStudioChat();
    const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
    const next = newStudioChat();
    const observations: string[] = [];
    studio.lifecycleStore.subscribe(state => { if (state.generation === 1) observations.push(new TextDecoder().decode(workspace.store.getState().files.get('new.js'))); });
    const replacement = studio.replaceWorkspace(async () => { await preparing; return { files: new Map([['new.js', toBytes('new')]]), fixtures: new Map(), session: { version: 2, chats: [next], activeChatId: next.id }, selection: { file: 'new.js', tableId: 'empty', tab: 'files' } }; });
    expect(studio.phase).toBe('preparing');
    await studio.saveFile('old.js', 'edit during preparation');
    block = true; prepared(); await committing;
    expect(studio.phase).toBe('committing'); expect(studio.generation).toBe(0);
    expect(workspace.text('old.js')).toBe('edit during preparation');
    await expect(studio.saveFile('old.js', 'late edit')).rejects.toThrow('committing');
    expect(await studio.turns.send('start during commit', 'controlled-key')).toBe(false);
    durable(); await replacement;
    expect(studio.phase).toBe('idle'); expect(studio.generation).toBe(1);
    expect(observations.every(text => text === 'new')).toBe(true);
    expect(studio.session.store.getState().activeChatId).toBe(next.id);
    expect(studio.lifecycleStore.getState().selection.file).toBe('new.js');
    await expect(studio.saveFile('old.js', 'old identity', 0)).rejects.toThrow('earlier workspace');
    studio.stop();
  });
  it('keeps accepted state, pending review and navigation after failed commit, then retries', async () => {
    let fail = true;
    const workspace = new Workspace(memoryStorage({ write: async () => { if (fail) throw new Error('Storage unavailable'); } }), new Map([['old.js', toBytes('old')]]));
    const chat = newStudioChat();
    const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
    const turn = studio.session.begin('review', 0)!;
    const stage = workspace.stage(); stage.write('old.js', 'review'); studio.session.finish(turn, stage);
    const pending = studio.session.store.getState().pending;
    const before = workspace.store.getState(), selection = studio.lifecycleStore.getState().selection;
    await expect(studio.resetProject()).rejects.toThrow('Storage unavailable');
    expect(studio.phase).toBe('failed'); expect(studio.generation).toBe(0);
    expect(workspace.store.getState()).toBe(before);
    expect(studio.session.store.getState().pending).toBe(pending);
    expect(studio.lifecycleStore.getState().selection).toBe(selection);
    fail = false; await studio.saveFile('old.js', 'recoverable edit');
    await studio.resetProject(); expect(studio.generation).toBe(1);
    expect(studio.session.store.getState().pending).toBeNull(); studio.stop();
  });
  it('does not destroy prior state when ZIP validation fails', async () => {
    const studio = setup(), before = studio.workspace.store.getState();
    await expect(studio.importProject(new File(['not a ZIP'], 'bad.zip'))).rejects.toThrow();
    expect(studio.phase).toBe('failed'); expect(studio.generation).toBe(0);
    expect(studio.workspace.store.getState()).toBe(before);
    await studio.saveFile('index.html', 'still editable'); studio.stop();
  });
});
