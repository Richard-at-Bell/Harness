import { describe, expect, it } from 'vitest';
import { StudioRuntime } from './studioRuntime';
import { readTable } from './fixtures';
import { importZip } from './export';
import { templateFiles } from './template';
import { newStudioChat, toBytes, Workspace } from './workspace';

function setup() {
  const workspace = new Workspace({ write: async () => {}, remove: async () => {} }, new Map([['index.html', toBytes('Project')]]), new Map([['fixtures/todos.csv', toBytes('id,title\n1,Original\n')]]));
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
  it('invalidates queued old requests at the reset boundary', async () => {
    const studio = setup();
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const blocker = studio.workspace.transaction(async () => { await gate; });
    const resetting = studio.resetProject();
    const stale = studio.tableRequest(0, 'todos', 'insert', { id: 'stale' }, () => true);
    release(); await blocker;
    expect(await resetting).toBe(1);
    await expect(stale).rejects.toThrow('earlier workspace');
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
