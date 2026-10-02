import { createStore } from 'zustand/vanilla';
import { createAgentTurns } from './agentTurns';
import { createSession, sessionRecord } from './sessionStore';
import { persistSession } from './sessionPersistence';
import { exportZip, importZip } from './export';
import { fixtureIds, readTable, tableBytes, type Row, type Table } from './fixtures';
import { templateFiles, templateFixtures } from './template';
import { copyFiles, loadReviewChanges, loadSession, newStudioChat, sameBytes, toBytes, validProjectPath, Workspace, type SavedSession, type WorkspaceWriter } from './workspace';

export class StudioRuntime {
  readonly session;
  private readonly lifecycle = createStore(() => ({ generation: 0 }));
  readonly lifecycleStore;
  readonly turns;
  private stopped = false;
  private persistence?: ReturnType<typeof persistSession>;
  private noticeTimer?: ReturnType<typeof setTimeout>;

  constructor(readonly workspace: Workspace, saved: SavedSession, review: boolean) {
    this.session = createSession(saved, review);
    const { getState, getInitialState, subscribe } = this.lifecycle;
    this.lifecycleStore = { getState, getInitialState, subscribe };
    this.turns = createAgentTurns({ workspace, session: this.session, generation: () => this.generation, transact: this.transact, flash: this.flash });
  }
  static async open() {
    const [workspace, session, review] = await Promise.all([Workspace.open(), loadSession(), loadReviewChanges()]);
    return new StudioRuntime(workspace, session, review);
  }
  get generation() { return this.lifecycle.getState().generation; }
  start() {
    this.stopped = false;
    if (!this.persistence) this.persistence = persistSession(this.session);
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
  transact = <T>(generation: number, operation: (writer: WorkspaceWriter) => Promise<T>): Promise<T> => this.workspace.transaction(async writer => {
    if (this.stopped || generation !== this.generation) throw new Error('This operation belongs to an earlier workspace');
    return operation(writer);
  });
  flash = (message: string) => {
    if (this.stopped) return;
    clearTimeout(this.noticeTimer); this.session.notice(message);
    this.noticeTimer = setTimeout(() => this.session.notice(''), 4200);
  };
  report = (error: unknown) => this.flash(String(error instanceof Error ? error.message : error));

  saveFile(path: string, content: string) {
    const generation = this.generation;
    return this.transact(generation, writer => writer.write(path, toBytes(content)));
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
      if (!sameBytes(writer.fixtures.get(draft.path), expected)) throw new Error('This table changed since editing began. Reload it before saving.');
      const next: Table = convert ? { ...draft, path: draft.path.replace(/\.(csv|xlsx)$/, draft.format === 'csv' ? '.xlsx' : '.csv'), format: draft.format === 'csv' ? 'xlsx' : 'csv' } : draft;
      await writer.writeFixture(next.path, await tableBytes(next));
      if (convert) await writer.removeFixture(draft.path);
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
  async importProject(file: File) {
    const captured = this.generation;
    const imported = await importZip(file);
    let committedGeneration = captured;
    await this.transact(captured, async writer => {
      this.advanceGeneration(); committedGeneration = this.generation;
      await writer.replace(imported.files, imported.fixtures);
      this.session.replaceSession({ version: 2, chats: imported.chats, activeChatId: imported.activeChatId });
    });
    if (committedGeneration === this.generation) this.flash('Project imported.');
    return { tableId: fixtureIds(imported.fixtures)[0] || 'todos', generation: committedGeneration };
  }
  async resetProject() {
    const captured = this.generation;
    let committedGeneration = captured;
    const chat = newStudioChat(this.session.store.getState().chats.find(chat => chat.id === this.session.store.getState().activeChatId)!.modelId);
    await this.transact(captured, async writer => {
      this.advanceGeneration(); committedGeneration = this.generation;
      await writer.replace(new Map(Object.entries(templateFiles).map(([p, v]) => [p, toBytes(v)])), new Map(Object.entries(templateFixtures).map(([p, v]) => [p, toBytes(v)])));
      this.session.replaceSession({ version: 2, chats: [chat], activeChatId: chat.id });
    });
    if (committedGeneration === this.generation) this.flash('Fresh to-do project created.');
    return committedGeneration;
  }
  async exportProject() {
    const snapshot = await this.transact(this.generation, async writer => ({ files: copyFiles(writer.files), fixtures: copyFiles(writer.fixtures), session: structuredClone(sessionRecord(this.session.store.getState())) }));
    return exportZip(snapshot.files, snapshot.fixtures, snapshot.session.chats, snapshot.session.activeChatId);
  }
}
