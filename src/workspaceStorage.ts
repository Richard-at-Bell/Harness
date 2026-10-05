import { openDB, type IDBPDatabase } from 'idb';
import { copyFiles, sameBytes, validFixturePath, validProjectPath, type FileMap, type SavedSession } from './workspace';

export type Selection = { file: string; tableId: string; tab: 'files' | 'data' };
export type Replacement = { identity: string; session: SavedSession; selection: Selection };
export type Change = { fixture: boolean; path: string; bytes?: Uint8Array };
export type Commit = { expectedRevision: number; changes: Change[]; replacement?: Replacement };
export type CommittedWorkspace = Replacement & { revision: number; files: FileMap; fixtures: FileMap; review: boolean; recovery?: string };
export interface WorkspaceStorage {
  commit(commit: Commit): Promise<{ revision: number; identity: string }>;
  saveSession?(identity: string, session: SavedSession): Promise<void>;
  saveReview?(identity: string, review: boolean): Promise<void>;
}
export class RevisionConflict extends Error {
  constructor() { super('Another tab changed this workspace. Copy unsaved drafts, then reopen the studio before retrying.'); }
}
type Pointer = { revision: number; identity: string };
type Manifest = Replacement & { revision: number; files: [string, string][]; fixtures: [string, string][]; review: boolean };
type Session = { identity: string; session: SavedSession; review: boolean };
export const WORKSPACE_DB = 'browser-project-studio-commits-v1';
export type StorageBoundary = 'prepared' | 'after-write' | 'before-activation' | 'activation';
// Hooks inject errors in tests; transaction hooks must be synchronous. Preparation
// writes nothing durable, so interruption cannot leave a prepared half-workspace.
export type StorageHooks = { prepare?: () => Promise<void>; boundary?: (at: StorageBoundary) => void };
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))].map(n => n.toString(16).padStart(2, '0')).join('');

export class IndexedWorkspaceStorage implements WorkspaceStorage {
  private constructor(private readonly db: IDBPDatabase, readonly hooks: StorageHooks) {}
  static async connect(name = WORKSPACE_DB, hooks: StorageHooks = {}) {
    const db = await openDB(name, 1, { upgrade(db) {
      db.createObjectStore('meta'); db.createObjectStore('manifests'); db.createObjectStore('blobs');
    } });
    return new IndexedWorkspaceStorage(db, hooks);
  }
  close() { this.db.close(); }
  // A single read transaction captures pointer, manifests, session and blobs.
  // Hash verification runs after it completes, before any state is published.
  async load(): Promise<CommittedWorkspace | undefined> {
    const tx = this.db.transaction(['meta', 'manifests', 'blobs']);
    const pointer = await tx.objectStore('meta').get('active') as Pointer | undefined;
    const session = await tx.objectStore('meta').get('session') as Session | undefined;
    const manifests = await tx.objectStore('manifests').getAll() as Manifest[];
    const keys = await tx.objectStore('blobs').getAllKeys();
    const values = await tx.objectStore('blobs').getAll() as Uint8Array[];
    await tx.done;
    if (!pointer && !manifests.length) return undefined;
    const blobs = new Map(keys.map((key, i) => [String(key), values[i]]));
    const verified = new Map<string, boolean>();
    const candidates = manifests.filter(m => m.revision <= (pointer?.revision ?? Infinity)).sort((a, b) => b.revision - a.revision);
    for (const manifest of candidates) {
      try {
        if (!manifest.identity || !manifest.session.chats.length || !manifest.session.chats.some(c => c.id === manifest.session.activeChatId)) throw new Error('Invalid metadata');
        for (const [fixture, entries] of [[false, manifest.files], [true, manifest.fixtures]] as const) {
          const paths = new Set<string>();
          for (const [path, hash] of entries) {
            if (!(fixture ? validFixturePath(path) : validProjectPath(path)) || paths.has(path)) throw new Error('Invalid manifest path');
            paths.add(path);
            if (!verified.has(hash)) verified.set(hash, blobs.get(hash) instanceof Uint8Array && await digest(blobs.get(hash)!) === hash);
            if (!verified.get(hash)) throw new Error('Missing or corrupt bytes');
          }
        }
        const result: CommittedWorkspace = { ...manifest, files: new Map(manifest.files.map(([p, h]) => [p, blobs.get(h)!.slice()])), fixtures: new Map(manifest.fixtures.map(([p, h]) => [p, blobs.get(h)!.slice()])) };
        if (session?.identity === manifest.identity) { result.session = session.session; result.review = session.review; }
        if (!pointer || manifest.revision !== pointer.revision || manifest.identity !== pointer.identity) {
          // Recovery is itself a CAS activation, never a regression of revision.
          const repair = this.db.transaction(['meta', 'manifests'], 'readwrite', { durability: 'strict' });
          const current = await repair.objectStore('meta').get('active') as Pointer | undefined;
          if (current?.revision !== pointer?.revision || current?.identity !== pointer?.identity) { repair.abort(); await repair.done.catch(() => {}); throw new RevisionConflict(); }
          result.revision = Math.max(pointer?.revision ?? 0, ...manifests.map(m => m.revision)) + 1;
          await repair.objectStore('manifests').put({ ...manifest, revision: result.revision, session: result.session, review: result.review }, result.revision);
          await repair.objectStore('meta').put({ revision: result.revision, identity: result.identity }, 'active');
          await repair.objectStore('meta').put({ identity: result.identity, session: result.session, review: result.review }, 'session');
          await repair.done;
          result.recovery = 'Recovered the last complete local revision. The newest damaged revision was not loaded.';
        }
        await this.collect().catch(() => {});
        return result;
      } catch (error) { if (error instanceof RevisionConflict) throw error; }
    }
    throw new Error('No complete local workspace revision can be recovered. Local records were preserved; restore an exported ZIP in a separate origin.');
  }
  async initialize(initial: Omit<CommittedWorkspace, 'revision'>) {
    // Concurrent migration is resolved by the same revision CAS as normal edits.
    await this.commit({ expectedRevision: -1, replacement: initial, changes: [
      ...[...initial.files].map(([path, bytes]) => ({ fixture: false, path, bytes })),
      ...[...initial.fixtures].map(([path, bytes]) => ({ fixture: true, path, bytes })),
    ] }, initial.review);
  }
  async commit(request: Commit, initialReview = true) {
    const prepared = await Promise.all(request.changes.map(async change => {
      if (!(change.fixture ? validFixturePath(change.path) : validProjectPath(change.path))) throw new Error('Invalid commit path');
      const bytes = change.bytes?.slice();
      return { ...change, bytes, hash: bytes ? await digest(bytes) : undefined };
    }));
    await this.hooks.prepare?.(); this.hooks.boundary?.('prepared');
    const tx = this.db.transaction(['meta', 'manifests', 'blobs'], 'readwrite', { durability: 'strict' });
    try {
      const meta = tx.objectStore('meta'), manifests = tx.objectStore('manifests'), blobs = tx.objectStore('blobs');
      const active = await meta.get('active') as Pointer | undefined;
      if ((active?.revision ?? -1) !== request.expectedRevision) throw new RevisionConflict();
      const prior = active ? await manifests.get(active.revision) as Manifest | undefined : undefined;
      if (active && !prior) throw new Error('Active manifest is missing; reopen to recover.');
      const saved = await meta.get('session') as Session | undefined;
      const replacement = request.replacement ?? prior;
      if (!replacement) throw new Error('Initial commit requires session metadata');
      const files = new Map(prior?.files), fixtures = new Map(prior?.fixtures);
      for (const change of prepared) {
        const paths = change.fixture ? fixtures : files;
        if (change.bytes && change.hash) { await blobs.put(change.bytes, change.hash); paths.set(change.path, change.hash); }
        else paths.delete(change.path);
        this.hooks.boundary?.('after-write');
      }
      const revision = (active?.revision ?? -1) + 1;
      const session = request.replacement?.session ?? saved?.session ?? replacement.session;
      const review = saved?.review ?? initialReview;
      const manifest: Manifest = { ...replacement, session, review, revision, files: [...files], fixtures: [...fixtures] };
      this.hooks.boundary?.('before-activation');
      await manifests.put(manifest, revision);
      await meta.put({ revision, identity: replacement.identity }, 'active');
      await meta.put({ identity: replacement.identity, session, review }, 'session');
      this.hooks.boundary?.('activation');
      await tx.done;
      // GC failure cannot turn a successful activation into a failed save.
      await this.collect().catch(() => {});
      return { revision, identity: replacement.identity };
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await tx.done.catch(() => {}); throw error;
    }
  }
  private async saveMetadata(identity: string, update: (saved: Session) => Session) {
    const tx = this.db.transaction('meta', 'readwrite', { durability: 'strict' });
    try {
      const active = await tx.store.get('active') as Pointer;
      if (active?.identity !== identity) throw new RevisionConflict();
      await tx.store.put(update(await tx.store.get('session') as Session), 'session');
      await tx.done;
    } catch (error) { try { tx.abort(); } catch { /* inactive */ } await tx.done.catch(() => {}); throw error; }
  }
  saveSession(identity: string, session: SavedSession) { return this.saveMetadata(identity, saved => ({ ...saved, session: structuredClone(session) })); }
  saveReview(identity: string, review: boolean) { return this.saveMetadata(identity, saved => ({ ...saved, review })); }
  async collect() {
    const tx = this.db.transaction(['meta', 'manifests', 'blobs'], 'readwrite');
    const active = await tx.objectStore('meta').get('active') as Pointer | undefined;
    const all = await tx.objectStore('manifests').getAll() as Manifest[];
    const retained = all.filter(m => m.revision <= (active?.revision ?? -1)).sort((a, b) => b.revision - a.revision).slice(0, 2);
    const revisions = new Set(retained.map(m => m.revision));
    const hashes = new Set(retained.flatMap(m => [...m.files, ...m.fixtures].map(([, hash]) => hash)));
    for (const m of all) if (!revisions.has(m.revision)) await tx.objectStore('manifests').delete(m.revision);
    for (const hash of await tx.objectStore('blobs').getAllKeys()) if (!hashes.has(String(hash))) await tx.objectStore('blobs').delete(hash);
    await tx.done;
  }
}

// In-memory atomic implementation for isolated operation tests. Fault callbacks
// are preparation only; they cannot make a partially accepted snapshot visible.
export function memoryStorage(hooks: { write?: (fixture: boolean, path: string, bytes: Uint8Array) => Promise<void>; remove?: (fixture: boolean, path: string) => Promise<void> } = {}): WorkspaceStorage {
  let revision = 0; let identity: string = crypto.randomUUID();
  return { async commit(request) {
    if (request.expectedRevision !== revision) throw new RevisionConflict();
    for (const change of request.changes) {
      if (change.bytes) await hooks.write?.(change.fixture, change.path, change.bytes.slice());
      else await hooks.remove?.(change.fixture, change.path);
    }
    revision++; identity = request.replacement?.identity ?? identity;
    return { revision, identity };
  } };
}
export function changesBetween(files: FileMap, fixtures: FileMap, nextFiles: FileMap, nextFixtures: FileMap): Change[] {
  return ([[false, files, nextFiles], [true, fixtures, nextFixtures]] as const).flatMap(([fixture, before, after]) => {
    const paths = new Set([...before.keys(), ...after.keys()]);
    return [...paths].filter(path => !sameBytes(before.get(path), after.get(path))).map(path => ({ fixture, path, bytes: after.get(path)?.slice() }));
  });
}
export const detachedWorkspace = (record: CommittedWorkspace): CommittedWorkspace => ({ ...structuredClone(record), files: copyFiles(record.files), fixtures: copyFiles(record.fixtures) });
