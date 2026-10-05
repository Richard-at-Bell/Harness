import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { IndexedWorkspaceStorage, type StorageBoundary, type StorageHooks } from './workspaceStorage';
import { newStudioChat, toBytes, toText, Workspace } from './workspace';

async function setup(hooks: StorageHooks = {}) {
  const name = `test-${crypto.randomUUID()}`;
  const storage = await IndexedWorkspaceStorage.connect(name, hooks);
  const chat = newStudioChat();
  const initial = { files: new Map([['a.js', toBytes('old-a')], ['b.js', toBytes('old-b')]]), fixtures: new Map([['fixtures/todos.csv', toBytes('id,title\n1,Old')]]), identity: 'original', session: { version: 2 as const, chats: [chat], activeChatId: chat.id }, selection: { file: 'a.js', tableId: 'todos', tab: 'files' as const }, review: true };
  await storage.initialize(initial);
  const record = (await storage.load())!;
  return { name, storage, initial, workspace: new Workspace(storage, record.files, record.fixtures, record) };
}
describe('durable workspace transactions', () => {
  for (const boundary of ['prepared', 'after-write', 'before-activation', 'activation'] as StorageBoundary[]) {
    it(`leaves a complete prior revision on failure at ${boundary}, then retries`, async () => {
      const hooks: StorageHooks = {};
      const { storage, initial, workspace } = await setup(hooks);
      const before = workspace.store.getState();
      hooks.boundary = at => { if (at === boundary) throw new Error('Injected failure'); };
      const chat = newStudioChat();
      const replacement = { identity: 'next', session: { version: 2 as const, chats: [chat], activeChatId: chat.id }, selection: initial.selection };
      const replace = () => workspace.transaction(writer => writer.replace(new Map([['a.js', toBytes('next-a')], ['c.js', toBytes('next-c')]]), new Map()), { replacement, activate: () => {} });
      await expect(replace()).rejects.toThrow('Injected failure');
      expect(workspace.store.getState()).toBe(before);
      hooks.boundary = undefined;
      const reopened = await storage.load();
      expect(reopened?.identity).toBe('original');
      expect(reopened?.session).toEqual(initial.session);
      expect([...reopened!.files].map(([p, b]) => [p, toText(b)])).toEqual([['a.js', 'old-a'], ['b.js', 'old-b']]);
      await replace();
      const next = (await storage.load())!;
      expect(next.identity).toBe('next'); expect(next.session).toEqual(replacement.session);
      expect([...next.files.keys()]).toEqual(['a.js', 'c.js']); expect(next.fixtures.size).toBe(0);
    });
  }
  it('resolves cross-connection races with a durable compare-and-swap', async () => {
    const { name, storage, workspace } = await setup();
    const second = await IndexedWorkspaceStorage.connect(name);
    const record = (await second.load())!;
    const other = new Workspace(second, record.files, record.fixtures, record);
    const results = await Promise.allSettled([workspace.write('a.js', toBytes('first')), other.write('b.js', toBytes('second'))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason.message).toContain('Another tab');
    const next = (await storage.load())!;
    expect([toText(next.files.get('a.js')!), toText(next.files.get('b.js')!)]).toEqual(results[0].status === 'fulfilled' ? ['first', 'old-b'] : ['old-a', 'second']);
    second.close();
  });
  it('rejects old queued session persistence after replacement', async () => {
    const { storage, initial, workspace } = await setup();
    const chat = newStudioChat();
    await workspace.transaction(async () => {}, { replacement: { identity: 'next', session: { version: 2, chats: [chat], activeChatId: chat.id }, selection: initial.selection }, activate: () => {} });
    await expect(storage.saveSession('original', initial.session)).rejects.toThrow('Another tab');
    expect((await storage.load())?.session.activeChatId).toBe(chat.id);
  });
  it.each(['missing', 'corrupt'])('recovers a complete retained revision when active bytes are %s', async damage => {
    const { name, storage, workspace } = await setup();
    await workspace.write('a.js', toBytes('new-a'));
    const db = await openDB(name);
    const manifest = await db.get('manifests', 1);
    const hash = manifest.files.find(([p]: [string, string]) => p === 'a.js')[1];
    if (damage === 'missing') await db.delete('blobs', hash); else await db.put('blobs', toBytes('corruption'), hash);
    const recovered = (await storage.load())!;
    expect(recovered.recovery).toContain('Recovered'); expect(toText(recovered.files.get('a.js')!)).toBe('old-a');
    expect(recovered.revision).toBe(2); expect((await storage.load())?.revision).toBe(2);
    db.close();
  });
  it('fails closed if no retained manifest is complete, preserving damaged records', async () => {
    const { name, storage } = await setup();
    const db = await openDB(name); await db.clear('blobs');
    await expect(storage.load()).rejects.toThrow('No complete');
    expect(await db.count('manifests')).toBe(1); db.close();
  });
  it('retains two manifests and collects unreferenced data after activation', async () => {
    const { name, storage, workspace } = await setup();
    for (const text of ['one', 'two', 'three']) await workspace.write('a.js', toBytes(text));
    const db = await openDB(name);
    await db.put('blobs', toBytes('orphan'), 'orphan');
    await storage.collect();
    expect(await db.getAllKeys('manifests')).toEqual([2, 3]);
    const retained = await db.getAll('manifests');
    const referenced = new Set(retained.flatMap(m => [...m.files, ...m.fixtures].map(([, hash]: [string, string]) => hash)));
    expect(new Set(await db.getAllKeys('blobs'))).toEqual(referenced); db.close();
  });
  it('migration activates once, survives failed preparation and ignores later legacy changes', async () => {
    const hooks: StorageHooks = {};
    const { name, initial } = await setup();
    const storage = await IndexedWorkspaceStorage.connect(`${name}-migration`, hooks);
    hooks.boundary = at => { if (at === 'activation') throw new Error('Interrupted migration'); };
    await expect(storage.initialize(initial)).rejects.toThrow('Interrupted');
    expect(await storage.load()).toBeUndefined();
    hooks.boundary = undefined; await storage.initialize(initial);
    initial.files.set('a.js', toBytes('changed legacy backup'));
    await expect(storage.initialize(initial)).rejects.toThrow('Another tab');
    expect(toText((await storage.load())!.files.get('a.js')!)).toBe('old-a');
  });
});
