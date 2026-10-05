import { DraftConflict } from './draftConflict';
import { createStore } from 'zustand/vanilla';
import type { FileMap } from './workspace';
import type { Selection } from './workspaceStorage';
import { createAgentTurns } from './agentTurns';
import { createSession, sessionRecord } from './sessionStore';
import { persistSession } from './sessionPersistence';
import { exportZip, importZip } from './export';
import { fixtureIds, readTable, tableBytes, type Row, type Table } from './fixtures';
import { templateFiles, templateFixtures } from './template';
import { copyFiles, newStudioChat, sameBytes, toBytes, validProjectPath, Workspace, type SavedSession, type WorkspaceWriter } from './workspace';

export type ReplacementPhase = 'idle' | 'preparing' | 'committing' | 'failed';
export type Lifecycle = { generation: number; phase: ReplacementPhase; error?: string; selection: Selection };

export class StudioRuntime {
  readonly session;
  private readonly lifecycle;
  readonly lifecycleStore;
  readonly turns;
  private stopped = false;
  private persistence?: ReturnType<typeof persistSession>;
  private noticeTimer?: ReturnType<typeof setTimeout>;

  constructor(readonly workspace: Workspace, saved: SavedSession, review: boolean) {
    this.session = createSession(saved, review);
    this.lifecycle = createStore<Lifecycle>()(() => ({ generation: 0, phase: 'idle', selection: workspace.opened?.selection ?? { file: workspace.files.has('app.js') ? 'app.js' : [...workspace.files.keys()][0] || 'index.html', tableId: fixtureIds(workspace.fixtures)[0] || 'todos', tab: 'files' } }));
    const { getState, getInitialState, subscribe } = this.lifecycle;
    this.lifecycleStore = { getState, getInitialState, subscribe };
    this.turns = createAgentTurns({ workspace, session: this.session, generation: () => this.generation, transact: this.transact, flash: this.flash, isAvailable: () => !this.stopped && this.phase !== 'committing' });
  }
  static async open() {
    const workspace = await Workspace.open();
    const studio = new StudioRuntime(workspace, workspace.opened!.session, workspace.opened!.review);
    if (workspace.opened!.recovery) studio.flash(workspace.opened!.recovery);
    return studio;
  }
  get generation() { return this.lifecycle.getState().generation; }
  get phase() { return this.lifecycle.getState().phase; }
  select(selection: Partial<Selection>) { if (this.phase !== 'committing') this.lifecycle.setState(current => ({ selection: { ...current.selection, ...selection } })); }
  start() {
    this.stopped = false;
    if (!this.persistence) this.persistence = persistSession(this.session, {
      identity: () => this.workspace.identity,
      saveSession: (session, identity) => this.workspace.saveSession(identity!, session),
      saveReviewChanges: (review, identity) => this.workspace.saveReview(identity!, review),
    });
    else this.persistence.start();
  }
  stop() {
    this.stopped = true;
    this.advanceGeneration();
    clearTimeout(this.noticeTimer);
    void this.persistence?.stop();
  }
  private advanceGeneration() {
    this.lifecycle.setState({ generation: this.generation + 1 }); this.turns.cancel();
  }
  transact = <T>(generation: number, operation: (writer: WorkspaceWriter) => Promise<T>): Promise<T> => {
    if (this.stopped || generation !== this.generation) return Promise.reject(new Error('This operation belongs to an earlier workspace'));
    if (this.phase === 'committing') return Promise.reject(new Error('Workspace replacement is committing. Your draft is retained; retry after it finishes.'));
    return this.workspace.transaction(async writer => {
      if (this.stopped || generation !== this.generation) throw new Error('This operation belongs to an earlier workspace');
      return operation(writer);
    });
  };
  flash = (message: string) => {
    if (this.stopped) return;
    clearTimeout(this.noticeTimer); this.session.notice(message);
    this.noticeTimer = setTimeout(() => this.session.notice(''), 4200);
  };
  report = (error: unknown) => this.flash(String(error instanceof Error ? error.message : error));

  saveFile(path: string, content: string, generation = this.generation, expected?: { bytes?: Uint8Array; isCurrent?: () => boolean }) {
    const baseline = expected?.bytes?.slice();
    return this.transact(generation, async writer => {
      if (expected?.isCurrent?.() === false) throw new Error('This document save was discarded');
      if (expected && !sameBytes(writer.files.get(path), baseline)) throw new DraftConflict('file');
      await writer.write(path, toBytes(content));
    });
  }
  createFile(path: string) {
    return this.transact(this.generation, async writer => {
      if (!validProjectPath(path) || writer.files.has(path)) throw new Error('Choose a valid new project path.');
      await writer.write(path, toBytes(''));
    });
  }
  createTable(id: string) {
    return this.transact(this.generation, async writer => {
      if (!/^[a-z0-9_-]{1,60}$/.test(id) || fixtureIds(writer.fixtures).includes(id)) throw new Error('Choose a new table name using letters, numbers, hyphens, or underscores.');
      await writer.writeFixture(`fixtures/${id}.csv`, await tableBytes({ path: `fixtures/${id}.csv`, format: 'csv', columns: ['id', 'name'], rows: [] }));
    });
  }
  saveTable(table: Table, baseline: Uint8Array, generation: number, convert = false) {
    const draft = structuredClone(table), expected = baseline.slice();
    return this.transact(generation, async writer => {
      if (!sameBytes(writer.fixtures.get(draft.path), expected)) throw new DraftConflict('table');
      const next: Table = convert ? { ...draft, path: draft.path.replace(/\.(csv|xlsx)$/, draft.format === 'csv' ? '.xlsx' : '.csv'), format: draft.format === 'csv' ? 'xlsx' : 'csv' } : draft;
      if (convert && writer.fixtures.has(next.path)) throw new DraftConflict('destination table');
      const bytes = await tableBytes(next);
      await writer.writeFixture(next.path, bytes);
      if (convert) await writer.removeFixture(draft.path);
      return { table: next, bytes };
    });
  }
  async importTable(file: File) {
    const generation = this.generation;
    const match = /^([a-z0-9_-]{1,60})\.(csv|xlsx)$/i.exec(file.name);
    if (!match) throw new Error('Use a CSV or XLSX filename with letters, numbers, hyphens, or underscores.');
    const id = match[1].toLowerCase(), path = `fixtures/${id}.${match[2].toLowerCase()}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 20_000_000) throw new Error('Fixture is larger than 20 MB');
    await readTable(new Map([[path, bytes]]), id);
    await this.transact(generation, async writer => {
      await writer.writeFixture(path, bytes);
      for (const existing of [`fixtures/${id}.csv`, `fixtures/${id}.xlsx`]) if (existing !== path) await writer.removeFixture(existing);
    });
    this.flash(`Imported ${id}.${match[2].toLowerCase()}.`); return id;
  }
  async tableRequest(generation: number, table: string, op: string, payload: any, isCurrent: () => boolean) {
    return this.transact(generation, async writer => {
      if (!isCurrent()) throw new Error('Preview was replaced');
      if (!['list', 'insert', 'update', 'remove'].includes(op) || !/^[a-z0-9_-]{1,60}$/i.test(table)) throw new Error('Invalid table request');
      if (JSON.stringify(payload ?? '').length > 200_000) throw new Error('Table request is too large');
      const current = await readTable(writer.fixtures, table);
      if (!isCurrent()) throw new Error('Preview was replaced');
      if (op === 'list') return current.rows;
      let value: Row | undefined;
      if (op === 'insert') {
        if (current.rows.length >= 10_000) throw new Error('Table is full');
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid row');
        value = { ...payload, id: payload.id || crypto.randomUUID() }; current.rows.push(value!);
      } else {
        const index = current.rows.findIndex(row => String(row.id) === String(payload?.id));
        if (index < 0) throw new Error('Row not found');
        if (op === 'update') { current.rows[index] = { ...current.rows[index], ...payload.patch }; value = current.rows[index]; }
        if (op === 'remove') value = current.rows.splice(index, 1)[0];
      }
      const bytes = await tableBytes(current);
      if (!isCurrent()) throw new Error('Preview was replaced');
      await writer.writeFixture(current.path, bytes);
      return value;
    });
  }
  // Preparation permits ordinary work. Commit gates new requests immediately;
  // already queued operations finish before replacement. Failure keeps identity,
  // session, navigation, buffers and preview capabilities of the prior workspace.
  async replaceWorkspace(prepare: () => Promise<{ files: FileMap; fixtures: FileMap; session: SavedSession; selection: Selection }>) {
    if (this.stopped || this.phase === 'preparing' || this.phase === 'committing') throw new Error('Workspace replacement is already in progress or the studio is closed');
    const captured = this.generation;
    this.lifecycle.setState({ phase: 'preparing', error: undefined });
    try {
      const prepared = await prepare();
      if (this.stopped || captured !== this.generation) throw new Error('This replacement belongs to an earlier workspace');
      const replacement = { identity: crypto.randomUUID(), session: structuredClone(prepared.session), selection: structuredClone(prepared.selection) };
      this.lifecycle.setState({ phase: 'committing' });
      await this.workspace.transaction(async writer => {
        if (this.stopped || captured !== this.generation) throw new Error('This replacement belongs to an earlier workspace');
        await writer.replace(prepared.files, prepared.fixtures);
      }, { replacement, activate: () => {
        if (this.stopped) return;
        this.turns.cancel();
        this.session.replaceSession(replacement.session);
        this.lifecycle.setState({ generation: captured + 1, selection: replacement.selection });
      } });
      if (!this.stopped) this.lifecycle.setState({ phase: 'idle' });
      return { tableId: replacement.selection.tableId, generation: captured + 1 };
    } catch (error) {
      if (!this.stopped) this.lifecycle.setState({ phase: 'failed', error: String(error instanceof Error ? error.message : error) });
      throw error;
    }
  }
  async importProject(file: File) {
    const result = await this.replaceWorkspace(async () => {
      const imported = await importZip(file);
      return { ...imported, session: { version: 2, chats: imported.chats, activeChatId: imported.activeChatId }, selection: { file: imported.files.has('index.html') ? 'index.html' : [...imported.files.keys()][0], tableId: fixtureIds(imported.fixtures)[0] || 'todos', tab: 'files' } };
    });
    if (result.generation === this.generation) this.flash('Project imported.');
    return result;
  }
  async resetProject() {
    const result = await this.replaceWorkspace(async () => {
      const chat = newStudioChat(this.session.store.getState().chats.find(chat => chat.id === this.session.store.getState().activeChatId)!.modelId);
      return { files: new Map(Object.entries(templateFiles).map(([p, v]) => [p, toBytes(v)])), fixtures: new Map(Object.entries(templateFixtures).map(([p, v]) => [p, toBytes(v)])), session: { version: 2, chats: [chat], activeChatId: chat.id }, selection: { file: 'app.js', tableId: 'todos', tab: 'files' } };
    });
    if (result.generation === this.generation) this.flash('Fresh to-do project created.');
    return result.generation;
  }
  async exportProject() {
    const snapshot = await this.transact(this.generation, async writer => ({ files: copyFiles(writer.files), fixtures: copyFiles(writer.fixtures), session: structuredClone(sessionRecord(this.session.store.getState())) }));
    return exportZip(snapshot.files, snapshot.fixtures, snapshot.session.chats, snapshot.session.activeChatId);
  }
}
