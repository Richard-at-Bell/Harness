import type { editor } from 'monaco-editor';
import { createStore } from 'zustand/vanilla';
import { DraftConflict } from './draftConflict';
import { RevisionConflict } from './workspaceStorage';
import { sameBytes, toBytes, type FileSnapshot } from './workspace';

export type EditorDraft = { text: string; request: number; status: 'saving' | 'error' | 'conflict'; baseline?: Uint8Array; accepted?: Uint8Array; requiresReopen?: boolean; error?: string };
type Model = { dispose: () => void };

// One editing session owns recoverable per-path buffers, save acknowledgement,
// trusted baselines and retained models. Accepted data remains in Workspace.
export class EditorDocuments {
  private readonly state = createStore(() => ({ drafts: new Map<string, EditorDraft>() }));
  readonly store;
  private sequence = 0;
  private epoch = 0;
  private active = true;
  private readonly models = new Set<Model>();
  private readonly views = new Map<string, editor.ICodeEditorViewState>();
  private readonly identity = crypto.randomUUID();
  private readonly baselines = new Map<string, Uint8Array | undefined>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly inFlight = new Map<string, { text: string; request: number }>();
  private readonly discarded = new Map<string, number>();

  constructor(private readonly save: (path: string, text: string, baseline?: Uint8Array, isCurrent?: () => boolean) => Promise<void>, private readonly report: (error: unknown) => void, private readonly accepted?: () => FileSnapshot) {
    const { getState, getInitialState, subscribe } = this.state;
    this.store = { getState, getInitialState, subscribe };
  }
  start() { this.active = true; }
  modelPath(path: string) { return `studio://editor/${this.identity}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  retainModel(model: Model | null) { if (this.active && model) this.models.add(model); }
  rememberView(uri: string, view: editor.ICodeEditorViewState | null) { if (this.active && view) this.views.set(uri, view); }
  view(uri: string) { return this.views.get(uri) ?? null; }
  private update(path: string, draft: EditorDraft | undefined) {
    this.state.setState(current => { const drafts = new Map(current.drafts); if (draft) drafts.set(path, draft); else drafts.delete(path); return { drafts }; });
  }
  observe(files: FileSnapshot) {
    if (!this.active) return;
    for (const [path, draft] of this.state.getState().drafts) {
      const bytes = files.get(path);
      if (sameBytes(bytes, this.baselines.get(path))) continue;
      const own = this.inFlight.get(path);
      if (own && sameBytes(bytes, toBytes(own.text))) {
        this.baselines.set(path, bytes?.slice());
        this.update(path, { ...draft, baseline: bytes?.slice(), accepted: bytes?.slice() });
      } else {
        this.update(path, { ...draft, status: 'conflict', accepted: bytes?.slice(), error: new DraftConflict('file').message });
      }
    }
  }
  edit(path: string, text: string): Promise<void> {
    if (!this.active) return Promise.resolve();
    const previous = this.state.getState().drafts.get(path), request = ++this.sequence;
    if (!this.baselines.has(path) || (!previous && this.accepted)) this.baselines.set(path, this.accepted?.().get(path)?.slice());
    const draft: EditorDraft = { ...previous, text, request, baseline: this.baselines.get(path)?.slice(), status: previous?.status === 'conflict' ? 'conflict' : 'saving' };
    this.update(path, draft);
    if (draft.status === 'conflict') return Promise.resolve();
    const epoch = this.epoch, discarded = this.discarded.get(path);
    const isCurrent = () => this.active && epoch === this.epoch && discarded === this.discarded.get(path);
    const run = async () => {
      if (!isCurrent() || this.state.getState().drafts.get(path)?.status === 'conflict') return;
      this.inFlight.set(path, { text, request });
      try {
        await this.save(path, text, this.baselines.get(path)?.slice(), isCurrent);
        if (!isCurrent()) return;
        const current = this.state.getState().drafts.get(path);
        if (current?.status === 'conflict') return;
        this.baselines.set(path, toBytes(text));
        // An owned older save can advance the baseline, never acknowledge a
        // newer request. Newer text stays immediately visible while queued.
        if (current?.request === request) this.update(path, undefined);
      } catch (error) {
        if (!isCurrent()) return;
        const current = this.state.getState().drafts.get(path);
        if (!current || current.status === 'conflict') return;
        const conflict = error instanceof DraftConflict || error instanceof RevisionConflict;
        if (conflict || current.request === request) {
          this.update(path, { ...current, status: conflict ? 'conflict' : 'error', requiresReopen: error instanceof RevisionConflict, error: String(error instanceof Error ? error.message : error), accepted: this.accepted?.().get(path)?.slice() });
          this.report(error);
        }
      } finally { if (this.inFlight.get(path)?.request === request) this.inFlight.delete(path); }
    };
    const prior = this.queues.get(path);
    const result = prior ? prior.then(run, run) : run();
    this.queues.set(path, result);
    return result;
  }
  retry(path: string) { const draft = this.state.getState().drafts.get(path); return draft?.status === 'error' ? this.edit(path, draft.text) : Promise.resolve(); }
  reload(path: string) {
    if (this.state.getState().drafts.get(path)?.requiresReopen) return;
    this.discarded.set(path, (this.discarded.get(path) ?? 0) + 1);
    this.baselines.set(path, this.accepted?.().get(path)?.slice());
    this.update(path, undefined);
  }
  stop() {
    this.active = false; this.epoch++;
    this.state.setState({ drafts: new Map() });
    this.baselines.clear(); this.inFlight.clear(); this.queues.clear(); this.discarded.clear();
    for (const model of this.models) model.dispose();
    this.models.clear(); this.views.clear();
  }
}
