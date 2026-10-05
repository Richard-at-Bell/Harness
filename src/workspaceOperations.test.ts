import { memoryStorage } from './workspaceStorage';
import { describe, expect, it } from 'vitest';
import { Workspace, Stage, toBytes, toText } from './workspace';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe('accepted workspace publication', () => {
  it('publishes after persistence, detaches byte ownership and preserves unaffected references', async () => {
    const gate = deferred();
    const workspace = new Workspace(memoryStorage({ write: () => gate.promise, remove: async () => {} }), new Map([['a.js', toBytes('a')], ['b.js', toBytes('b')]]));
    const before = workspace.store.getState();
    const bytes = toBytes('changed');
    const saving = workspace.write('a.js', bytes);
    bytes.fill(0);
    expect(workspace.store.getState()).toBe(before);
    gate.resolve(); await saving;
    const after = workspace.store.getState();
    expect(toText(after.files.get('a.js')!)).toBe('changed');
    expect(after.files.get('b.js')).toBe(before.files.get('b.js'));
    expect(after.fixtures).toBe(before.fixtures);
    workspace.snapshot().get('a.js')!.fill(0);
    after.files.get('a.js')!.fill(0); // Even a misbehaving subscriber cannot change accepted bytes.
    expect(workspace.text('a.js')).toBe('changed');
    const baseline = new Map([['a.js', toBytes('baseline')]]);
    const stage = new Stage(baseline, 1);
    baseline.get('a.js')!.fill(0); stage.files.get('a.js')!.fill(0);
    expect(toText(stage.baseline.get('a.js')!)).toBe('baseline');
  });

  it('serializes entire read-modify-write operations and checks revisions inside the queue', async () => {
    const gate = deferred();
    const workspace = new Workspace(memoryStorage({ write: async () => {}, remove: async () => {} }), new Map([['a.js', toBytes('0')]]));
    const first = workspace.transaction(async writer => { const n = Number(toText(writer.files.get('a.js')!)); await gate.promise; await writer.write('a.js', toBytes(String(n + 1))); });
    const second = workspace.transaction(async writer => { const n = Number(toText(writer.files.get('a.js')!)); await writer.write('a.js', toBytes(String(n + 1))); });
    const staleAcceptance = workspace.transaction(async writer => { if (writer.revision !== 0) throw new Error('stale revision'); });
    gate.resolve(); await Promise.all([first, second]);
    await expect(staleAcceptance).rejects.toThrow('stale revision');
    expect(workspace.text('a.js')).toBe('2');
  });

  it('rolls back failed batches and keeps the queue usable', async () => {
    const workspace = new Workspace(memoryStorage({ write: async (_fixture, path) => { if (path === 'fail.js') throw new Error('full'); }, remove: async () => {} }), new Map());
    let notifications = 0;
    workspace.store.subscribe(() => { notifications++; });
    await expect(workspace.replace(new Map([['ok.js', toBytes('ok')], ['fail.js', toBytes('bad')]]))).rejects.toThrow('full');
    expect(workspace.store.getState().files.has('ok.js')).toBe(false);
    expect(workspace.store.getState().files.has('fail.js')).toBe(false);
    expect(notifications).toBe(0);
    await workspace.write('next.js', toBytes('next'));
    expect(workspace.text('next.js')).toBe('next');
  });
});
