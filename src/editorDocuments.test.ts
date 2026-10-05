import { StudioRuntime } from './studioRuntime';
import { memoryStorage } from './workspaceStorage';
import { describe, expect, it, vi } from 'vitest';
import { EditorDocuments } from './editorDocuments';
import { newStudioChat, Workspace, toBytes } from './workspace';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('editor buffer acknowledgement', () => {
  it('keeps the latest failed buffer after an earlier save succeeds, then retries it', async () => {
    const gate = deferred();
    let attempts = 0;
    const workspace = new Workspace(memoryStorage({ write: async () => {
      if (++attempts === 1) await gate.promise;
      if (attempts === 2) throw new Error('Storage full');
    }, remove: async () => {} }), new Map([['app.js', toBytes('original')]]));
    const report = vi.fn();
    const documents = new EditorDocuments((path, text) => workspace.write(path, toBytes(text)), report);

    const first = documents.edit('app.js', 'first edit');
    const latest = documents.edit('app.js', 'latest edit');
    gate.resolve(); await Promise.all([first, latest]);
    expect(workspace.text('app.js')).toBe('first edit');
    expect(documents.store.getState().drafts.get('app.js')).toMatchObject({ text: 'latest edit', status: 'error', error: 'Storage full' });
    expect(report).toHaveBeenCalledOnce();

    await documents.retry('app.js');
    expect(workspace.text('app.js')).toBe('latest edit');
    expect(documents.store.getState().drafts.has('app.js')).toBe(false);
  });

  it('does not let an older completion or failure replace a newer edit', async () => {
    const first = deferred(), latest = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    const report = vi.fn();
    const documents = new EditorDocuments(save, report);
    const oldRequest = documents.edit('app.js', 'old');
    const newRequest = documents.edit('app.js', 'new');
    first.reject(new Error('Old failure')); await oldRequest;
    expect(documents.store.getState().drafts.get('app.js')).toMatchObject({ text: 'new', status: 'saving' });
    expect(report).not.toHaveBeenCalled();
    latest.resolve(); await newRequest;
    expect(documents.store.getState().drafts.size).toBe(0);
  });

  it('keeps failed buffers per file while other files save', async () => {
    const documents = new EditorDocuments(async path => { if (path === 'app.js') throw new Error('Write failed'); }, () => {});
    await documents.edit('app.js', 'recoverable');
    await documents.edit('styles.css', 'saved');
    expect(documents.store.getState().drafts.get('app.js')?.text).toBe('recoverable');
    expect(documents.store.getState().drafts.has('styles.css')).toBe(false);
  });

  it('invalidates pending callbacks at the editor session boundary', async () => {
    const gate = deferred(), report = vi.fn();
    const documents = new EditorDocuments(() => gate.promise, report);
    const saving = documents.edit('app.js', 'old workspace');
    documents.stop(); documents.start();
    gate.reject(new Error('Late failure')); await saving;
    expect(documents.store.getState().drafts.size).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });
});

describe('editor model ownership', () => {
  it('retains models for navigation and disposes every owned model once at teardown', () => {
    const documents = new EditorDocuments(async () => {}, () => {});
    const app = { dispose: vi.fn() }, css = { dispose: vi.fn() };
    const appPath = documents.modelPath('app.js');
    documents.retainModel(app);
    documents.modelPath('styles.css'); documents.retainModel(css);
    documents.retainModel(app);
    expect(documents.modelPath('app.js')).toBe(appPath);
    expect(app.dispose).not.toHaveBeenCalled();
    expect(css.dispose).not.toHaveBeenCalled();
    documents.stop(); documents.stop();
    expect(app.dispose).toHaveBeenCalledOnce();
    expect(css.dispose).toHaveBeenCalledOnce();
    const replacement = new EditorDocuments(async () => {}, () => {});
    expect(replacement.modelPath('app.js')).not.toBe(appPath);
    expect(documents.modelPath('folder/a#b.js')).toContain('/folder/a%23b.js');
  });
});


describe('file draft conflicts', () => {
  it('retains failed text across external edits and never retries it over newer bytes', async () => {
    let fail = true;
    const workspace = new Workspace(memoryStorage({ write: async () => { if (fail) throw new Error('Full'); } }), new Map([['app.js', toBytes('baseline')]]));
    const chat = newStudioChat();
    const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
    const documents = new EditorDocuments((path, text, bytes, isCurrent) => studio.saveFile(path, text, 0, { bytes, isCurrent }), () => {}, () => workspace.store.getState().files);
    const unsubscribe = workspace.store.subscribe(state => documents.observe(state.files));
    await documents.edit('app.js', 'my recoverable draft');
    fail = false; await workspace.write('app.js', toBytes('agent edit'));
    expect(documents.store.getState().drafts.get('app.js')).toMatchObject({ text: 'my recoverable draft', status: 'conflict' });
    await documents.retry('app.js'); await documents.edit('app.js', 'more local changes');
    expect(workspace.text('app.js')).toBe('agent edit');
    documents.reload('app.js');
    expect(documents.store.getState().drafts.has('app.js')).toBe(false);
    await documents.edit('app.js', 'deliberate fresh edit');
    expect(workspace.text('app.js')).toBe('deliberate fresh edit');
    unsubscribe(); documents.stop(); studio.stop();
  });
  it('advances owned save baselines without confusing acknowledgements with conflicts', async () => {
    const workspace = new Workspace(memoryStorage(), new Map([['app.js', toBytes('baseline')]]));
    const chat = newStudioChat();
    const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
    const documents = new EditorDocuments((path, text, bytes, isCurrent) => studio.saveFile(path, text, 0, { bytes, isCurrent }), () => {}, () => workspace.store.getState().files);
    const unsubscribe = workspace.store.subscribe(state => documents.observe(state.files));
    await Promise.all([documents.edit('app.js', 'first'), documents.edit('app.js', 'latest')]);
    expect(workspace.text('app.js')).toBe('latest'); expect(documents.store.getState().drafts.size).toBe(0);
    await workspace.write('app.js', toBytes('external clean change'));
    await documents.edit('app.js', 'edited new accepted content');
    expect(workspace.text('app.js')).toBe('edited new accepted content');
    unsubscribe(); documents.stop(); studio.stop();
  });
  it('checks the baseline inside the operation queue even before observation arrives', async () => {
    const workspace = new Workspace(memoryStorage(), new Map([['app.js', toBytes('baseline')]]));
    const chat = newStudioChat();
    const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
    const documents = new EditorDocuments((path, text, bytes) => studio.saveFile(path, text, 0, { bytes }), () => {}, () => workspace.store.getState().files);
    const external = workspace.write('app.js', toBytes('external'));
    const local = documents.edit('app.js', 'local');
    await Promise.all([external, local]);
    expect(workspace.text('app.js')).toBe('external');
    expect(documents.store.getState().drafts.get('app.js')?.status).toBe('conflict');
    documents.stop(); studio.stop();
  });
});
