import { openDB, type IDBPDatabase } from 'idb';
import { createStore } from 'zustand/vanilla';
import { templateFiles, templateFixtures } from './template';
import { DEFAULT_MODEL } from './models';
import { changesBetween, IndexedWorkspaceStorage, RevisionConflict, type CommittedWorkspace, type Replacement, type WorkspaceStorage } from './workspaceStorage';

export type FileMap = Map<string, Uint8Array>;
// Published maps and their byte values are read-only to consumers. Working
// snapshots are deep copies; typed arrays cannot be frozen by JavaScript.
export type FileSnapshot = ReadonlyMap<string, Uint8Array>;
export type ChatLine = { id: string; role: 'user' | 'assistant' | 'system'; text: string; time: string; model?: string };
export type ToolLine = { id: string; time: string; name: string; status: 'started' | 'ok' | 'error'; summary: string; input?: string; output?: string; durationMs?: number };
export type StudioChat = { id: string; title: string; createdAt: string; updatedAt: string; chat: ChatLine[]; tools: ToolLine[]; agentMessages: unknown[]; modelId: string };
export type SavedSession = { version: 2; chats: StudioChat[]; activeChatId: string };
type LegacySession = { chat?: ChatLine[]; tools?: ToolLine[]; agentMessages?: unknown[]; modelId?: string };

export function newStudioChat(modelId = DEFAULT_MODEL): StudioChat {
  const time = new Date().toISOString();
  return { id: crypto.randomUUID(), title: 'New chat', createdAt: time, updatedAt: time, chat: [], tools: [], agentMessages: [], modelId };
}

export function titleForChat(prompt: string): string {
  const title = prompt.replace(/\s+/g, ' ').trim();
  return title.length > 45 ? `${title.slice(0, 44).trimEnd()}…` : title || 'New chat';
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const toBytes = (text: string) => encoder.encode(text);
export const toText = (bytes: Uint8Array) => decoder.decode(bytes);

export function validPath(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => !part || part === '.' || part === '..') && !/(^|\/)\.env(?:\.|$)/i.test(path) && path.length < 240;
}
export function validFixturePath(path: string): boolean { return /^fixtures\/[a-z0-9_-]{1,60}\.(csv|xlsx)$/.test(path); }
export function validProjectPath(path: string): boolean { return validPath(path) && !path.startsWith('fixtures/') && !path.startsWith('studio/'); }

async function metaDb(): Promise<IDBPDatabase> {
  return openDB('browser-project-studio-v1', 1, {
    upgrade(db) { db.createObjectStore('meta'); },
  });
}

export function normalizeSession(stored?: SavedSession | LegacySession): SavedSession {
  if (stored && 'version' in stored && stored.version === 2 && Array.isArray(stored.chats) && stored.chats.length) {
    return { version: 2, chats: stored.chats, activeChatId: stored.chats.some(chat => chat.id === stored.activeChatId) ? stored.activeChatId : stored.chats[0].id };
  }
  const old = stored as LegacySession | undefined;
  const chat = newStudioChat(old?.modelId || DEFAULT_MODEL);
  chat.chat = old?.chat || [];
  chat.tools = old?.tools || [];
  chat.agentMessages = old?.agentMessages || [];
  if (chat.chat.length) chat.title = titleForChat(chat.chat.find(line => line.role === 'user')?.text || 'Imported chat');
  return { version: 2, chats: [chat], activeChatId: chat.id };
}

export async function loadSession(): Promise<SavedSession> {
  const db = await metaDb();
  const current = await db.get('meta', 'session-v2') as SavedSession | undefined;
  if (current?.version === 2 && Array.isArray(current.chats) && current.chats.length) return normalizeSession(current);
  return normalizeSession(await db.get('meta', 'session') as SavedSession | LegacySession | undefined);
}

export async function loadReviewChanges(): Promise<boolean> {
  return (await (await metaDb()).get('meta', 'review-agent-changes')) !== false;
}

async function storageRoots(): Promise<{ project: FileSystemDirectoryHandle; fixtures: FileSystemDirectoryHandle }> {
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support local project storage. Use a current desktop Chromium browser.');
  const root = await navigator.storage.getDirectory();
  return { project: await root.getDirectoryHandle('browser-project-studio-v1', { create: true }), fixtures: await root.getDirectoryHandle('browser-project-studio-fixtures-v1', { create: true }) };
}

async function readAll(dir: FileSystemDirectoryHandle, prefix = ''): Promise<FileMap> {
  const out: FileMap = new Map();
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    const path = prefix + name;
    if (handle.kind === 'directory') {
      const nested = await readAll(handle as FileSystemDirectoryHandle, path + '/');
      for (const entry of nested) out.set(...entry);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.set(path, new Uint8Array(await file.arrayBuffer()));
    }
  }
  return out;
}

export type WorkspaceSnapshot = { readonly files: FileSnapshot; readonly fixtures: FileSnapshot; readonly revision: number; readonly identity: string };
export type WorkspaceWriter = {
  readonly files: FileMap; readonly fixtures: FileMap; readonly revision: number;
  snapshot(): FileMap; fixtureSnapshot(): FileMap; stage(): Stage;
  write(path: string, bytes: Uint8Array): Promise<void>; remove(path: string): Promise<void>;
  writeFixture(path: string, bytes: Uint8Array): Promise<void>; removeFixture(path: string): Promise<void>;
  replace(files: FileMap, fixtures?: FileMap): Promise<void>;
};
export type Activation = { replacement: Replacement; activate: () => void };

export function copyFiles(files: FileSnapshot): FileMap {
  return new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
}
export function sameBytes(a?: Uint8Array, b?: Uint8Array): boolean {
  if (a === b) return true;
  return a && b ? a.length === b.length && a.every((byte, index) => byte === b[index]) : a === b;
}
function publishFiles(files: FileMap, previous: FileSnapshot, acceptedBefore: FileMap): FileSnapshot {
  if (files.size === previous.size && [...files].every(([path, bytes]) => sameBytes(bytes, acceptedBefore.get(path)))) return previous;
  return new Map([...files].map(([path, bytes]) => [path, sameBytes(bytes, acceptedBefore.get(path)) ? previous.get(path)! : bytes.slice()]));
}

// Operations stage detached maps. Only a completed storage transaction changes
// accepted bytes; the local queue and the durable revision CAS serve different scopes.
export class Workspace {
  private acceptedFiles: FileMap;
  private acceptedFixtures: FileMap;
  private currentRevision: number;
  private currentIdentity: string;
  private operations: Promise<unknown> = Promise.resolve();
  private readonly publication;
  readonly store;

  constructor(private readonly storage: WorkspaceStorage, files: FileMap, fixtures: FileMap = new Map(), readonly opened?: CommittedWorkspace) {
    this.acceptedFiles = copyFiles(files); this.acceptedFixtures = copyFiles(fixtures);
    this.currentRevision = opened?.revision ?? 0; this.currentIdentity = opened?.identity ?? crypto.randomUUID();
    this.publication = createStore<WorkspaceSnapshot>()(() => ({ files: copyFiles(files), fixtures: copyFiles(fixtures), revision: this.revision, identity: this.identity }));
    const { getState, getInitialState, subscribe } = this.publication;
    this.store = { getState, getInitialState, subscribe };
  }
  static async open(): Promise<Workspace> {
    const storage = await IndexedWorkspaceStorage.connect();
    let committed = await storage.load();
    if (!committed) {
      // Read legacy data without mutating it. One CAS activation completes the
      // migration; a crash or quota failure leaves legacy data fully recoverable.
      const roots = await storageRoots();
      const files = await readAll(roots.project), fixtures = await readAll(roots.fixtures);
      for (const [path, bytes] of files) if (validFixturePath(path)) {
        if (!fixtures.has(path)) fixtures.set(path, bytes);
        files.delete(path);
      }
      if (!files.size) {
        for (const [path, text] of Object.entries(templateFiles)) files.set(path, toBytes(text));
        if (!fixtures.size) for (const [path, text] of Object.entries(templateFixtures)) fixtures.set(path, toBytes(text));
      }
      const [session, review] = await Promise.all([loadSession(), loadReviewChanges()]);
      try { await storage.initialize({ files, fixtures, session, review, identity: crypto.randomUUID(), selection: { file: files.has('app.js') ? 'app.js' : [...files.keys()][0], tableId: 'todos', tab: 'files' } }); }
      catch (error) { if (!(error instanceof RevisionConflict)) throw error; }
      committed = await storage.load();
    }
    if (!committed) throw new Error('Workspace activation failed');
    return new Workspace(storage, committed.files, committed.fixtures, committed);
  }
  get files(): FileMap { return this.snapshot(); }
  get fixtures(): FileMap { return this.fixtureSnapshot(); }
  get revision(): number { return this.currentRevision; }
  get identity(): string { return this.currentIdentity; }
  read(path: string): Uint8Array | undefined { return this.acceptedFiles.get(path)?.slice(); }
  text(path: string): string { return toText(this.acceptedFiles.get(path) || new Uint8Array()); }
  snapshot(): FileMap { return copyFiles(this.acceptedFiles); }
  fixtureSnapshot(): FileMap { return copyFiles(this.acceptedFixtures); }
  stage(): Stage { return new Stage(this.snapshot(), this.revision, this.fixtureSnapshot()); }
  saveSession(identity: string, session: SavedSession) { return this.storage.saveSession?.(identity, session) ?? Promise.resolve(); }
  saveReview(identity: string, review: boolean) { return this.storage.saveReview?.(identity, review) ?? Promise.resolve(); }

  transaction<T>(operation: (writer: WorkspaceWriter) => Promise<T>, activation?: Activation): Promise<T> {
    const run = async () => {
      let files = new Map(this.acceptedFiles), fixtures = new Map(this.acceptedFixtures);
      const change = async (fixture: boolean, path: string, bytes?: Uint8Array) => {
        if (!(fixture ? validFixturePath(path) : validProjectPath(path))) throw new Error('Invalid path');
        const target = fixture ? fixtures : files;
        if (bytes) target.set(path, bytes.slice()); else target.delete(path);
      };
      const writer: WorkspaceWriter = {
        get files() { return copyFiles(files); }, get fixtures() { return copyFiles(fixtures); }, revision: this.revision,
        snapshot: () => copyFiles(files), fixtureSnapshot: () => copyFiles(fixtures), stage: () => new Stage(files, this.revision, fixtures),
        write: (path, bytes) => change(false, path, bytes), remove: path => change(false, path),
        writeFixture: (path, bytes) => change(true, path, bytes), removeFixture: path => change(true, path),
        replace: async (nextFiles, nextFixtures = fixtures) => {
          for (const path of nextFiles.keys()) if (!validProjectPath(path)) throw new Error(`Invalid project path: ${path}`);
          for (const path of nextFixtures.keys()) if (!validFixturePath(path)) throw new Error(`Invalid fixture path: ${path}`);
          files = copyFiles(nextFiles); fixtures = copyFiles(nextFixtures);
        },
      };
      const result = await operation(writer);
      const changes = changesBetween(this.acceptedFiles, this.acceptedFixtures, files, fixtures);
      if (changes.length || activation) {
        const committed = await this.storage.commit({ expectedRevision: this.revision, changes, replacement: activation?.replacement });
        const beforeFiles = this.acceptedFiles, beforeFixtures = this.acceptedFixtures;
        this.acceptedFiles = files; this.acceptedFixtures = fixtures;
        this.currentRevision = committed.revision;
        if (activation) this.currentIdentity = committed.identity;
        const previous = this.publication.getState();
        // Accepted service data is already new when activation observers run.
        // Runtime keeps operation gating in place until all stores are reconciled.
        this.publication.setState({ files: publishFiles(files, previous.files, beforeFiles), fixtures: publishFiles(fixtures, previous.fixtures, beforeFixtures), revision: this.revision, identity: this.identity });
        activation?.activate();
      }
      return result;
    };
    const result = this.operations.then(run, run); this.operations = result.catch(() => {}); return result;
  }
  write(path: string, bytes: Uint8Array) { const owned = bytes.slice(); return this.transaction(writer => writer.write(path, owned)); }
  remove(path: string) { return this.transaction(writer => writer.remove(path)); }
  writeFixture(path: string, bytes: Uint8Array) { const owned = bytes.slice(); return this.transaction(writer => writer.writeFixture(path, owned)); }
  removeFixture(path: string) { return this.transaction(writer => writer.removeFixture(path)); }
  replace(files: FileMap, fixtures?: FileMap) { const owned = copyFiles(files), ownedFixtures = fixtures && copyFiles(fixtures); return this.transaction(writer => writer.replace(owned, ownedFixtures)); }
}

export class Stage {
  readonly baseRevision: number;
  readonly baseline: FileMap;
  readonly fixtureBaseline: FileMap;
  files: FileMap;
  fixtures: FileMap;
  constructor(baseline: FileMap, revision: number, fixtureBaseline: FileMap = new Map()) { this.baseline = copyFiles(baseline); this.files = copyFiles(baseline); this.fixtureBaseline = copyFiles(fixtureBaseline); this.fixtures = copyFiles(fixtureBaseline); this.baseRevision = revision; }
  list(): string[] { return [...this.files.keys()].sort(); }
  read(path: string): Uint8Array | undefined { return this.files.get(path); }
  text(path: string): string { return toText(this.files.get(path) || new Uint8Array()); }
  write(path: string, text: string): void { this.writeBytes(path, toBytes(text)); }
  writeBytes(path: string, bytes: Uint8Array): void { if (!validProjectPath(path)) throw new Error('Invalid project path'); this.files.set(path, bytes.slice()); }
  remove(path: string): void { if (!validProjectPath(path)) throw new Error('Invalid project path'); this.files.delete(path); }
  writeFixtureBytes(path: string, bytes: Uint8Array): void { if (!validFixturePath(path)) throw new Error('Invalid fixture path'); this.fixtures.set(path, bytes.slice()); }
  readBaseline(path: string): Uint8Array | undefined { return (validFixturePath(path) ? this.fixtureBaseline : this.baseline).get(path); }
  readCurrent(path: string): Uint8Array | undefined { return (validFixturePath(path) ? this.fixtures : this.files).get(path); }
  changes(): string[] {
    const paths = new Set([...this.baseline.keys(), ...this.files.keys(), ...this.fixtureBaseline.keys(), ...this.fixtures.keys()]);
    return [...paths].filter(path => {
      const a = this.readBaseline(path), b = this.readCurrent(path);
      if (a === b) return true;
  return a && b ? a.length !== b.length || a.some((byte, index) => byte !== b[index]) : a !== b;
    }).sort();
  }
}
