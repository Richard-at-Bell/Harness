import { openDB, type IDBPDatabase } from 'idb';
import { templateFiles } from './template';

export type FileMap = Map<string, Uint8Array>;
export type ChatLine = { id: string; role: 'user' | 'assistant' | 'system'; text: string; time: string; model?: string };
export type ToolLine = { id: string; time: string; name: string; status: 'started' | 'ok' | 'error'; summary: string; input?: string; output?: string; durationMs?: number };
export type SavedSession = { chat: ChatLine[]; tools: ToolLine[]; agentMessages: unknown[]; modelId?: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const toBytes = (text: string) => encoder.encode(text);
export const toText = (bytes: Uint8Array) => decoder.decode(bytes);

export function validPath(path: string): boolean {
  return Boolean(path) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => !part || part === '.' || part === '..') && !/(^|\/)\.env(?:\.|$)/i.test(path) && path.length < 240;
}

async function metaDb(): Promise<IDBPDatabase> {
  return openDB('browser-project-studio-v1', 1, {
    upgrade(db) { db.createObjectStore('meta'); },
  });
}

export async function loadSession(): Promise<SavedSession> {
  const db = await metaDb();
  return (await db.get('meta', 'session')) || { chat: [], tools: [], agentMessages: [] };
}

export async function saveSession(session: SavedSession): Promise<void> {
  const db = await metaDb();
  await db.put('meta', session, 'session');
}

async function projectRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support local project storage. Use a current desktop Chromium browser.');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('browser-project-studio-v1', { create: true });
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
  files: FileMap;
  revision = 0;
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(root: FileSystemDirectoryHandle, files: FileMap) { this.root = root; this.files = files; }

  static async open(): Promise<Workspace> {
    const root = await projectRoot();
    const files = await readAll(root);
    const workspace = new Workspace(root, files);
    if (!files.size) await workspace.replace(new Map(Object.entries(templateFiles).map(([p, v]) => [p, toBytes(v)])));
    return workspace;
  }

  read(path: string): Uint8Array | undefined { return this.files.get(path); }
  text(path: string): string { return toText(this.files.get(path) || new Uint8Array()); }
  snapshot(): FileMap { return new Map(this.files); }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (!validPath(path)) throw new Error('Invalid project path');
    this.files = new Map(this.files).set(path, bytes);
    this.revision++;
    this.writes = this.writes.then(() => writeFile(this.root, path, bytes));
    await this.writes;
  }

  async remove(path: string): Promise<void> {
    if (!validPath(path)) throw new Error('Invalid project path');
    if (!this.files.has(path)) return;
    const next = new Map(this.files); next.delete(path); this.files = next; this.revision++;
    this.writes = this.writes.then(() => removeFile(this.root, path));
    await this.writes;
  }

  async replace(files: FileMap): Promise<void> {
    for (const path of files.keys()) if (!validPath(path)) throw new Error(`Invalid project path: ${path}`);
    await this.writes;
    for (const path of this.files.keys()) if (!files.has(path)) await removeFile(this.root, path);
    for (const [path, bytes] of files) await writeFile(this.root, path, bytes);
    this.files = new Map(files);
    this.revision++;
  }

  stage(): Stage { return new Stage(this.snapshot(), this.revision); }
}

export class Stage {
  readonly baseRevision: number;
  readonly baseline: FileMap;
  files: FileMap;
  constructor(baseline: FileMap, revision: number) { this.baseline = baseline; this.files = new Map(baseline); this.baseRevision = revision; }
  list(): string[] { return [...this.files.keys()].sort(); }
  read(path: string): Uint8Array | undefined { return this.files.get(path); }
  text(path: string): string { return toText(this.files.get(path) || new Uint8Array()); }
  write(path: string, text: string): void { this.writeBytes(path, toBytes(text)); }
  writeBytes(path: string, bytes: Uint8Array): void { if (!validPath(path)) throw new Error('Invalid project path'); this.files.set(path, bytes); }
  remove(path: string): void { if (!validPath(path)) throw new Error('Invalid project path'); this.files.delete(path); }
  changes(): string[] {
    const paths = new Set([...this.baseline.keys(), ...this.files.keys()]);
    return [...paths].filter(path => {
      const a = this.baseline.get(path), b = this.files.get(path);
      return a && b ? a.length !== b.length || a.some((byte, index) => byte !== b[index]) : a !== b;
    }).sort();
  }
}
