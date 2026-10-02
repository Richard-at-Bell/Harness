import { openDB, type IDBPDatabase } from 'idb';
import { templateFiles, templateFixtures } from './template';
import { DEFAULT_MODEL } from './models';

export type FileMap = Map<string, Uint8Array>;
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
  await writer.write(bytes as BlobPart);
  await writer.close();
}

async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  await dir.removeEntry(parts.at(-1)!);
}

export class Workspace {
  private root: FileSystemDirectoryHandle;
  private fixtureRoot: FileSystemDirectoryHandle;
  files: FileMap;
  fixtures: FileMap;
  revision = 0;
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(root: FileSystemDirectoryHandle, fixtureRoot: FileSystemDirectoryHandle, files: FileMap, fixtures: FileMap) { this.root = root; this.fixtureRoot = fixtureRoot; this.files = files; this.fixtures = fixtures; }

  static async open(): Promise<Workspace> {
    const roots = await storageRoots();
    const files = await readAll(roots.project);
    const fixtures = await readAll(roots.fixtures);
    // Existing workspaces kept fixtures under the project root. Copy first, then remove.
    for (const [path, bytes] of files) if (validFixturePath(path)) {
      if (!fixtures.has(path)) { await writeFile(roots.fixtures, path, bytes); fixtures.set(path, bytes); }
      await removeFile(roots.project, path);
      files.delete(path);
    }
    const workspace = new Workspace(roots.project, roots.fixtures, files, fixtures);
    if (!files.size) await workspace.replace(
      new Map(Object.entries(templateFiles).map(([p, v]) => [p, toBytes(v)])),
      fixtures.size ? fixtures : new Map(Object.entries(templateFixtures).map(([p, v]) => [p, toBytes(v)])),
    );
    return workspace;
  }

  read(path: string): Uint8Array | undefined { return this.files.get(path); }
  text(path: string): string { return toText(this.files.get(path) || new Uint8Array()); }
  snapshot(): FileMap { return new Map(this.files); }
  fixtureSnapshot(): FileMap { return new Map(this.fixtures); }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (!validProjectPath(path)) throw new Error('Invalid project path');
    this.files = new Map(this.files).set(path, bytes);
    this.revision++;
    this.writes = this.writes.then(() => writeFile(this.root, path, bytes));
    await this.writes;
  }

  async remove(path: string): Promise<void> {
    if (!validProjectPath(path)) throw new Error('Invalid project path');
    if (!this.files.has(path)) return;
    const next = new Map(this.files); next.delete(path); this.files = next; this.revision++;
    this.writes = this.writes.then(() => removeFile(this.root, path));
    await this.writes;
  }

  async writeFixture(path: string, bytes: Uint8Array): Promise<void> {
    if (!validFixturePath(path)) throw new Error('Invalid fixture path');
    this.fixtures = new Map(this.fixtures).set(path, bytes);
    this.revision++;
    this.writes = this.writes.then(() => writeFile(this.fixtureRoot, path, bytes));
    await this.writes;
  }

  async removeFixture(path: string): Promise<void> {
    if (!validFixturePath(path)) throw new Error('Invalid fixture path');
    if (!this.fixtures.has(path)) return;
    const next = new Map(this.fixtures); next.delete(path); this.fixtures = next; this.revision++;
    this.writes = this.writes.then(() => removeFile(this.fixtureRoot, path));
    await this.writes;
  }

  async replace(files: FileMap, fixtures: FileMap = this.fixtures): Promise<void> {
    for (const path of files.keys()) if (!validProjectPath(path)) throw new Error(`Invalid project path: ${path}`);
    for (const path of fixtures.keys()) if (!validFixturePath(path)) throw new Error(`Invalid fixture path: ${path}`);
    await this.writes;
    for (const path of this.files.keys()) if (!files.has(path)) await removeFile(this.root, path);
    for (const [path, bytes] of files) await writeFile(this.root, path, bytes);
    for (const path of this.fixtures.keys()) if (!fixtures.has(path)) await removeFile(this.fixtureRoot, path);
    for (const [path, bytes] of fixtures) await writeFile(this.fixtureRoot, path, bytes);
    this.files = new Map(files);
    this.fixtures = new Map(fixtures);
    this.revision++;
  }

  stage(): Stage { return new Stage(this.snapshot(), this.revision, this.fixtureSnapshot()); }
}

export class Stage {
  readonly baseRevision: number;
  readonly baseline: FileMap;
  readonly fixtureBaseline: FileMap;
  files: FileMap;
  fixtures: FileMap;
  constructor(baseline: FileMap, revision: number, fixtureBaseline: FileMap = new Map()) { this.baseline = baseline; this.files = new Map(baseline); this.fixtureBaseline = fixtureBaseline; this.fixtures = new Map(fixtureBaseline); this.baseRevision = revision; }
  list(): string[] { return [...this.files.keys()].sort(); }
  read(path: string): Uint8Array | undefined { return this.files.get(path); }
  text(path: string): string { return toText(this.files.get(path) || new Uint8Array()); }
  write(path: string, text: string): void { this.writeBytes(path, toBytes(text)); }
  writeBytes(path: string, bytes: Uint8Array): void { if (!validProjectPath(path)) throw new Error('Invalid project path'); this.files.set(path, bytes); }
  remove(path: string): void { if (!validProjectPath(path)) throw new Error('Invalid project path'); this.files.delete(path); }
  writeFixtureBytes(path: string, bytes: Uint8Array): void { if (!validFixturePath(path)) throw new Error('Invalid fixture path'); this.fixtures.set(path, bytes); }
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
