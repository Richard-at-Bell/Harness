import { createStore } from 'zustand/vanilla';
import { readTable, tablePath, type Table } from './fixtures';
import { DraftConflict } from './draftConflict';
import { sameBytes, type FileSnapshot } from './workspace';
import { RevisionConflict } from './workspaceStorage';

export type TableDraft = { table: Table; baseline: Uint8Array; accepted?: Uint8Array; request: number; dirty: boolean; status: 'clean' | 'dirty' | 'saving' | 'error' | 'conflict'; error?: string };
// Parsed tables have explicit save/convert actions, unlike automatically saved
// source buffers. They retain their own schema/row and parse lifetimes.
export class TableDocuments {
  private readonly state = createStore(() => ({ drafts: new Map<string, TableDraft>() }));
  readonly store;
  private active = true;
  private sequence = 0;
  private epoch = 0;
  private readonly parsing = new Map<string, number>();
  private readonly saving = new Map<string, number>();
  constructor(private readonly accepted: () => FileSnapshot, private readonly persist: (table: Table, baseline: Uint8Array, convert: boolean) => Promise<{ table: Table; bytes: Uint8Array }>, private readonly report: (error: unknown) => void) {
    const { getState, getInitialState, subscribe } = this.state;
    this.store = { getState, getInitialState, subscribe };
  }
  start() { this.active = true; }
  private update(id: string, draft?: TableDraft) {
    this.state.setState(current => { const drafts = new Map(current.drafts); if (draft) drafts.set(id, draft); else drafts.delete(id); return { drafts }; });
  }
  observe(fixtures: FileSnapshot) { for (const id of this.state.getState().drafts.keys()) void this.load(id, fixtures); }
  async load(id: string, fixtures = this.accepted()) {
    if (!this.active) return;
    const path = tablePath(fixtures, id), bytes = path ? fixtures.get(path) : undefined;
    const draft = this.state.getState().drafts.get(id);
    if (draft && path === draft.table.path && sameBytes(bytes, draft.baseline)) return;
    if (draft?.dirty) {
      // While saving, preserve every observation without guessing whether it
      // acknowledges our request. The durable result identifies its exact bytes.
      if (this.saving.has(id)) this.update(id, { ...draft, accepted: bytes?.slice() });
      else this.update(id, { ...draft, status: 'conflict', accepted: bytes?.slice(), error: new DraftConflict('table').message });
      return;
    }
    const epoch = this.epoch;
    const token = (this.parsing.get(id) ?? 0) + 1; this.parsing.set(id, token);
    if (!path || !bytes) { this.update(id); return; }
    try {
      const table = await readTable(new Map([[path, bytes]]), id);
      // A user edit or save owns the row set after this parse began.
      if (!this.active || this.epoch !== epoch || this.parsing.get(id) !== token || this.state.getState().drafts.get(id)?.dirty) return;
      this.update(id, { table, baseline: bytes.slice(), accepted: bytes.slice(), request: ++this.sequence, dirty: false, status: 'clean' });
    } catch (error) { if (this.active && this.epoch === epoch && this.parsing.get(id) === token) this.report(error); }
  }
  edit(id: string, update: (table: Table) => Table) {
    const draft = this.state.getState().drafts.get(id);
    if (!this.active || !draft) return;
    this.update(id, { ...draft, table: update(draft.table), request: ++this.sequence, dirty: true, status: draft.status === 'conflict' ? 'conflict' : this.saving.has(id) ? 'saving' : 'dirty' });
  }
  async save(id: string, convert = false) {
    const draft = this.state.getState().drafts.get(id);
    if (!this.active || !draft || draft.status === 'conflict' || this.saving.has(id) || draft.status === 'saving') return;
    const epoch = this.epoch;
    const request = draft.request, table = structuredClone(draft.table), baseline = draft.baseline.slice();
    this.update(id, { ...draft, dirty: true, status: 'saving', error: undefined });
    try {
      this.saving.set(id, request);
      const { table: next, bytes } = await this.persist(table, baseline, convert);
      if (!this.active || epoch !== this.epoch) return;
      const current = this.state.getState().drafts.get(id);
      if (!current) return;
      const accepted = this.accepted();
      if (tablePath(accepted, id) !== next.path || !sameBytes(accepted.get(next.path), bytes)) {
        this.update(id, { ...current, status: 'conflict', accepted: accepted.get(tablePath(accepted, id) ?? '')?.slice(), error: new DraftConflict('table').message });
        return;
      }
      const dirty = current.request !== request;
      this.update(id, { ...current, table: { ...current.table, path: next.path, format: next.format }, baseline: bytes, accepted: bytes, dirty, status: dirty ? 'dirty' : 'clean' });
    } catch (error) {
      if (!this.active || epoch !== this.epoch) return;
      const current = this.state.getState().drafts.get(id);
      if (!current || current.status === 'conflict') return;
      const conflict = error instanceof DraftConflict || error instanceof RevisionConflict;
      this.update(id, { ...current, status: conflict ? 'conflict' : 'error', error: String(error instanceof Error ? error.message : error) });
      this.report(error);
    } finally { if (epoch === this.epoch) this.saving.delete(id); }
  }
  async reload(id: string) {
    if (this.saving.has(id) || this.state.getState().drafts.get(id)?.status === 'saving') return;
    this.update(id); await this.load(id);
  }
  // Copying the parsed representation preserves columns/rows even if its source
  // XLSX has been removed or converted externally. It never writes accepted data.
  copy(id: string) { const draft = this.state.getState().drafts.get(id); return draft ? JSON.stringify(draft.table, null, 2) : ''; }
  stop() { this.active = false; this.epoch++; this.parsing.clear(); this.saving.clear(); this.state.setState({ drafts: new Map() }); }
}
