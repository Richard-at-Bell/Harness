import { openDB, type IDBPDatabase } from 'idb';
import { createStore } from 'zustand/vanilla';
import { templateFiles, templateFixtures } from './template';
import { DEFAULT_MODEL } from './models';

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

export async function saveSession(session: SavedSession): Promise<void> {
  if (session.version !== 2 || !Array.isArray(session.chats) || !session.chats.length || !session.chats.some(chat => chat.id === session.activeChatId)) throw new Error('Invalid chat session');
  const db = await metaDb();
  await db.put('meta', session, 'session-v2');
}

export async function loadReviewChanges(): Promise<boolean> {
  return (await (await metaDb()).get('meta', 'review-agent-changes')) !== false;
}

export async function saveReviewChanges(enabled: boolean): Promise<void> {
  await (await metaDb()).put('meta', enabled, 'review-agent-changes');
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

async function writeFile(root: FileSystemDirectoryHandle, path: string, bytes: Uint8Array): Promise<void> {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(parts.at(-1)!, { create: true });
  const writer = await handle.createWritable();
  try { await writer.write(bytes as BlobPart); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  await dir.removeEntry(parts.at(-1)!);
}

export type WorkspaceSnapshot = { readonly files: FileSnapshot; readonly fixtures: FileSnapshot; readonly revision: number };
export type WorkspaceStorage = {
  write: (fixture: boolean, path: string, bytes: Uint8Array) => Promise<void>;
  remove: (fixture: boolean, path: string) => Promise<void>;
};
export type WorkspaceWriter = Pick<Workspace, 'files' | 'fixtures' | 'revision' | 'snapshot' | 'fixtureSnapshot' | 'stage' | 'write' | 'remove' | 'writeFixture' | 'removeFixture' | 'replace'>;

export function copyFiles(files: FileSnapshot): FileMap {
  return new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
}
export function sameBytes(a?: Uint8Array, b?: Uint8Array): boolean {
  return a && b ? a.length === b.length && a.every((byte, index) => byte === b[index]) : a === b;
}
function publishFiles(files: FileMap, previous: FileSnapshot): FileSnapshot {
  if (files.size === previous.size && [...files].every(([path, bytes]) => sameBytes(bytes, previous.get(path)))) return previous;
  return new Map([...files].map(([path, bytes]) => [path, sameBytes(bytes, previous.get(path)) ? previous.get(path)! : bytes.slice()]));
}

// Storage owns accepted bytes. The store is a read-only published projection;
// callers get detached working snapshots, never the storage-owned byte arrays.
export class Workspace {
  private acceptedFiles: FileMap;
  private acceptedFixtures: FileMap;
  private currentRevision = 0;
  private operations: Promise<unknown> = Promise.resolve();
  private readonly publication;
  readonly store;

  constructor(private readonly storage: WorkspaceStorage, files: FileMap, fixtures: FileMap = new Map()) {
    this.acceptedFiles = copyFiles(files);
    this.acceptedFixtures = copyFiles(fixtures);
    this.publication = createStore<WorkspaceSnapshot>()(() => ({ files: copyFiles(files), fixtures: copyFiles(fixtures), revision: 0 }));
    const { getState, getInitialState, subscribe } = this.publication;
    this.store = { getState, getInitialState, subscribe };
  }

  static async open(): Promise<Workspace> {
    const roots = await storageRoots();
    const files = await readAll(roots.project);
    const fixtures = await readAll(roots.fixtures);
    for (const [path, bytes] of files) if (validFixturePath(path)) {
      if (!fixtures.has(path)) { await writeFile(roots.fixtures, path, bytes); fixtures.set(path, bytes); }
      await removeFile(roots.project, path);
      files.delete(path);
    }
    const workspace = new Workspace({
      write: (fixture, path, bytes) => writeFile(fixture ? roots.fixtures : roots.project, path, bytes),
      remove: (fixture, path) => removeFile(fixture ? roots.fixtures : roots.project, path),
    }, files, fixtures);
    if (!files.size) await workspace.replace(
      new Map(Object.entries(templateFiles).map(([p, v]) => [p, toBytes(v)])),
      fixtures.size ? fixtures : new Map(Object.entries(templateFixtures).map(([p, v]) => [p, toBytes(v)])),
    );
    return workspace;
  }

  get files(): FileMap { return this.snapshot(); }
  get fixtures(): FileMap { return this.fixtureSnapshot(); }
  get revision(): number { return this.currentRevision; }
  read(path: string): Uint8Array | undefined { return this.acceptedFiles.get(path)?.slice(); }
  text(path: string): string { return toText(this.acceptedFiles.get(path) || new Uint8Array()); }
  snapshot(): FileMap { return copyFiles(this.acceptedFiles); }
  fixtureSnapshot(): FileMap { return copyFiles(this.acceptedFixtures); }
  stage(): Stage { return new Stage(this.snapshot(), this.revision, this.fixtureSnapshot()); }

  // Protect the entire read/parse/modify/serialize/write operation, including
  // revision checks. Inside the callback use this writer, not queued methods.
  transaction<T>(operation: (writer: WorkspaceWriter) => Promise<T>): Promise<T> {
    const run = async () => {
      const workspace = this;
      const writer: WorkspaceWriter = {
        get files() { return workspace.snapshot(); },
        get fixtures() { return workspace.fixtureSnapshot(); },
        get revision() { return workspace.revision; },
        snapshot: () => this.snapshot(), fixtureSnapshot: () => this.fixtureSnapshot(), stage: () => this.stage(),
        write: (path, bytes) => this.commitWrite(false, path, bytes),
        remove: path => this.commitRemove(false, path),
        writeFixture: (path, bytes) => this.commitWrite(true, path, bytes),
        removeFixture: path => this.commitRemove(true, path),
        replace: (files, fixtures) => this.commitReplace(files, fixtures ?? this.acceptedFixtures),
      };
      try { return await operation(writer); }
      finally {
        const previous = this.publication.getState();
        if (previous.revision !== this.revision) this.publication.setState({
          files: publishFiles(this.acceptedFiles, previous.files),
          fixtures: publishFiles(this.acceptedFixtures, previous.fixtures), revision: this.revision,
        });
      }
    };
    const result = this.operations.then(run, run);
    this.operations = result.catch(() => {});
    return result;
  }

  private async commitWrite(fixture: boolean, path: string, bytes: Uint8Array): Promise<void> {
    if (!(fixture ? validFixturePath(path) : validProjectPath(path))) throw new Error(fixture ? 'Invalid fixture path' : 'Invalid project path');
    const owned = bytes.slice();
    const files = fixture ? this.acceptedFixtures : this.acceptedFiles;
    if (sameBytes(files.get(path), owned)) return;
    await this.storage.write(fixture, path, owned.slice());
    files.set(path, owned);
    this.currentRevision++;
  }
  private async commitRemove(fixture: boolean, path: string): Promise<void> {
    if (!(fixture ? validFixturePath(path) : validProjectPath(path))) throw new Error('Invalid path');
    const files = fixture ? this.acceptedFixtures : this.acceptedFiles;
    if (!files.has(path)) return;
    await this.storage.remove(fixture, path);
    files.delete(path);
    this.currentRevision++;
  }
  private async commitReplace(files: FileMap, fixtures: FileMap): Promise<void> {
    for (const path of files.keys()) if (!validProjectPath(path)) throw new Error(`Invalid project path: ${path}`);
    for (const path of fixtures.keys()) if (!validFixturePath(path)) throw new Error(`Invalid fixture path: ${path}`);
    // Successful individual writes remain authoritative if a later disk write
    // fails. Finally publishes that partial success and the queue stays usable.
    for (const [path, bytes] of files) await this.commitWrite(false, path, bytes);
    for (const [path, bytes] of fixtures) await this.commitWrite(true, path, bytes);
    for (const path of this.acceptedFiles.keys()) if (!files.has(path)) await this.commitRemove(false, path);
    for (const path of this.acceptedFixtures.keys()) if (!fixtures.has(path)) await this.commitRemove(true, path);
  }
  write(path: string, bytes: Uint8Array): Promise<void> { const owned = bytes.slice(); return this.transaction(writer => writer.write(path, owned)); }
  remove(path: string): Promise<void> { return this.transaction(writer => writer.remove(path)); }
  writeFixture(path: string, bytes: Uint8Array): Promise<void> { const owned = bytes.slice(); return this.transaction(writer => writer.writeFixture(path, owned)); }
  removeFixture(path: string): Promise<void> { return this.transaction(writer => writer.removeFixture(path)); }
  replace(files: FileMap, fixtures?: FileMap): Promise<void> {
    const ownedFiles = copyFiles(files), ownedFixtures = fixtures && copyFiles(fixtures);
    return this.transaction(writer => writer.replace(ownedFiles, ownedFixtures));
  }
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
      return a && b ? a.length !== b.length || a.some((byte, index) => byte !== b[index]) : a !== b;
    }).sort();
  }
}
