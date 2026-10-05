import { createStore } from 'zustand/vanilla';

export type EditorDraft = { text: string; request: number; status: 'saving' | 'error'; error?: string };
type Model = { dispose: () => void };

// An editor session owns recoverable buffers and model lifetimes, not accepted
// workspace bytes. Save acknowledgement belongs to one request and one path.
export class EditorDocuments {
  private readonly state = createStore(() => ({ drafts: new Map<string, EditorDraft>() }));
  readonly store;
  private sequence = 0;
  private active = true;
  private readonly models = new Set<Model>();
  private readonly identity = crypto.randomUUID();

  constructor(private readonly save: (path: string, text: string) => Promise<void>, private readonly report: (error: unknown) => void) {
    const { getState, getInitialState, subscribe } = this.state;
    this.store = { getState, getInitialState, subscribe };
  }

  start() { this.active = true; }
  modelPath(path: string) { return `studio://editor/${this.identity}/${path.split('/').map(encodeURIComponent).join('/')}`; }
  retainModel(model: Model | null) { if (this.active && model) this.models.add(model); }

  async edit(path: string, text: string) {
    if (!this.active) return;
    const request = ++this.sequence;
    this.state.setState(current => ({ drafts: new Map(current.drafts).set(path, { text, request, status: 'saving' }) }));
    try {
      await this.save(path, text);
      if (!this.active || this.state.getState().drafts.get(path)?.request !== request) return;
      this.state.setState(current => { const drafts = new Map(current.drafts); drafts.delete(path); return { drafts }; });
    } catch (error) {
      if (!this.active || this.state.getState().drafts.get(path)?.request !== request) return;
      this.state.setState(current => ({ drafts: new Map(current.drafts).set(path, { text, request, status: 'error', error: String(error instanceof Error ? error.message : error) }) }));
      this.report(error);
    }
  }

  retry(path: string) {
    const draft = this.state.getState().drafts.get(path);
    return draft?.status === 'error' ? this.edit(path, draft.text) : Promise.resolve();
  }

  stop() {
    this.active = false;
    this.state.setState({ drafts: new Map() });
    for (const model of this.models) model.dispose();
    this.models.clear();
  }
}
