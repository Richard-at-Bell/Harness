import { createRoot } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import '../../src/configureMonaco';
import '../../src/styles.css';
import { App } from '../../src/App';
import { StudioContext } from '../../src/studioContext';
import { StudioRuntime } from '../../src/studioRuntime';
import { Workspace, newStudioChat, toBytes } from '../../src/workspace';
import { IndexedWorkspaceStorage, type StorageBoundary, type StorageHooks } from '../../src/workspaceStorage';
import { createTools } from '../../src/agent';
import { createAgentTurns } from '../../src/agentTurns';

// Only this separate Vite test entry exposes controls. It is excluded from the
// production build and always runs in Playwright's new browser context.
const hooks: StorageHooks = {};
const storage = await IndexedWorkspaceStorage.connect('isolated-browser-tests', hooks);
let accepted = await storage.load();
if (!accepted) {
  const chat = newStudioChat();
  await storage.initialize({ files: new Map([['app.js', toBytes('const message = "original";\n')], ['styles.css', toBytes('body { color: blue; }\n')], ['index.html', toBytes('<h1>Isolated preview</h1>')]]), fixtures: new Map([['fixtures/todos.csv', toBytes('id,title\n1,Original\n')], ['fixtures/other.csv', toBytes('id,title\n2,Other\n')]]), identity: crypto.randomUUID(), session: { version: 2, chats: [chat], activeChatId: chat.id }, review: true, selection: { file: 'app.js', tableId: 'todos', tab: 'files' } });
  accepted = await storage.load();
}
const workspace = new Workspace(storage, accepted!.files, accepted!.fixtures, accepted!);
const runtime = new StudioRuntime(workspace, accepted!.session, accepted!.review);
runtime.start();
const root = createRoot(document.getElementById('root')!);
root.render(<StudioContext.Provider value={runtime}><App /></StudioContext.Provider>);
const control = {
  runtime,
  fault(at?: StorageBoundary) { hooks.boundary = at ? boundary => { if (boundary === at) throw new Error(`Injected storage failure: ${at}`); } : undefined; },
  async agentFile(path: string, text: string) {
    runtime.session.setReview(false);
    const turns = createAgentTurns({ workspace, session: runtime.session, generation: () => runtime.generation, transact: runtime.transact, flash: () => {} }, async (_text, _key, _model, stage, _history, callbacks) => {
      await callbacks.beforeTool?.(); const before = stage.files.get(path)?.slice(); stage.write(path, text);
      await callbacks.onChange?.({ path, before, after: stage.files.get(path)?.slice() });
      return { text: 'Controlled edit completed', messages: [] };
    });
    await turns.send('Controlled test edit', 'no-live-provider');
  },
  async agentRow(table: string, handle: string, revision: number, patch: Record<string, unknown>, review = false) {
    runtime.session.setReview(review);
    const turns = createAgentTurns({ workspace, session: runtime.session, generation: () => runtime.generation, transact: runtime.transact, flash: () => {} }, async (_text, _key, _model, stage, _history, callbacks) => {
      await createTools(stage, callbacks).find(t => t.name === 'update_row')!.execute('controlled', { table, handle, revision, patch });
      return { text: 'Controlled row edit', messages: [] };
    });
    await turns.send('Controlled row edit', 'no-live-provider');
  },
  editorViews() { return monaco.editor.getEditors().map(editor => ({ uri: editor.getModel()?.uri.toString(), position: editor.getPosition() })); },
  modelValues() { return monaco.editor.getModels().map(model => ({ uri: model.uri.toString(), text: model.getValue() })); },
  dispose() { root.unmount(); runtime.stop(); storage.close(); },
};
(window as any).__studioTest = control;
