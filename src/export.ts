import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import type { ChatLine, FileMap, StudioChat, ToolLine } from './workspace';
import { newStudioChat, titleForChat, toBytes, toText, validFixturePath, validPath, validProjectPath } from './workspace';
import { migrateDatasets } from './datasetService';
import { seedScript } from './fixtures';

type ExportManifest = { format: 'browser-project-studio'; version: 1 | 2 | 3; datasetMetadataVersion?: 1; exportedAt: string; entry: string; files: string[]; fixtureFiles?: string[]; activeChatId?: string; sha256: Record<string, string> };
type ChatMeta = Pick<StudioChat, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'modelId'>;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportZip(files: FileMap, fixtures: FileMap, chats: StudioChat[], activeChatId: string): Promise<Blob> {
  fixtures = await migrateDatasets(fixtures);
  const archive = new ZipWriter(new BlobWriter('application/zip'));
  const paths = [...files.keys()].filter(path => path !== 'fixture-seed.js' && validProjectPath(path)).sort();
  const fixturePaths = [...fixtures.keys()].filter(validFixturePath).sort();
  const hashes: Record<string, string> = {};
  async function add(path: string, bytes: Uint8Array) { await archive.add(path, new Uint8ArrayReader(bytes)); hashes[path] = await sha256(bytes); }
  for (const path of paths) await add(`project/${path}`, files.get(path)!);
  for (const path of fixturePaths) await add(`studio/${path}`, fixtures.get(path)!);
  await add('project/fixture-seed.js', toBytes(await seedScript(fixtures)));
  const readme = `# Project\n\nServe this folder with any static file server, then open index.html. Initial table rows are bundled in fixture-seed.js; the editable CSV/XLSX fixture files live in the ZIP's studio/fixtures folder. While running outside the studio, changes are saved in that browser's local storage; the page can call StudioData.download('todos') to download the latest rows as CSV. A static site cannot silently rewrite source files on disk.\n`;
  if (!files.has('README.md')) await add('project/README.md', toBytes(readme));
  const metadata: ChatMeta[] = chats.map(({ id, title, createdAt, updatedAt, modelId }) => ({ id, title, createdAt, updatedAt, modelId }));
  await add('studio/chats.json', toBytes(JSON.stringify(metadata, null, 2)));
  await add('studio/chat.jsonl', toBytes(chats.flatMap(session => session.chat.map(line => JSON.stringify({ chatId: session.id, ...line }))).join('\n') + '\n'));
  await add('studio/tool-events.jsonl', toBytes(chats.flatMap(session => session.tools.map(line => JSON.stringify({ chatId: session.id, ...line }))).join('\n') + '\n'));
  const manifest: ExportManifest = { format: 'browser-project-studio', version: 3, datasetMetadataVersion: 1, exportedAt: new Date().toISOString(), entry: 'project/index.html', files: [...new Set([...paths, 'fixture-seed.js', 'README.md'])], fixtureFiles: fixturePaths, activeChatId, sha256: hashes };
  await archive.add('manifest.json', new Uint8ArrayReader(toBytes(JSON.stringify(manifest, null, 2))));
  return archive.close();
}

export async function importZip(blob: Blob): Promise<{ files: FileMap; fixtures: FileMap; chats: StudioChat[]; activeChatId: string }> {
  const archive = new ZipReader(new BlobReader(blob));
  const entries = await archive.getEntries();
  const unpacked: FileMap = new Map();
  try {
    if (entries.length > 1000) throw new Error('ZIP contains too many files');
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.directory) continue;
      if (entry.uncompressedSize > 20_000_000) throw new Error(`File is too large: ${entry.filename}`);
      totalBytes += entry.uncompressedSize;
      if (totalBytes > 100_000_000) throw new Error('ZIP contents exceed 100 MB');
      if (!validPath(entry.filename) || unpacked.has(entry.filename)) throw new Error(`Unsafe ZIP path: ${entry.filename}`);
      unpacked.set(entry.filename, await entry.getData!(new Uint8ArrayWriter()));
    }
  } finally { await archive.close(); }
  let prefix = '';
  let chats: StudioChat[] = [];
  let activeChatId = '';
  let version = 0;
  const readLines = <T>(path: string): T[] => toText(unpacked.get(path) || new Uint8Array()).split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
  if (unpacked.has('manifest.json')) {
    const manifest = JSON.parse(toText(unpacked.get('manifest.json')!)) as ExportManifest;
    if (manifest.format !== 'browser-project-studio' || ![1, 2, 3].includes(manifest.version)) throw new Error('Unsupported studio ZIP version');
    version = manifest.version;
    if (version >= 2) {
      // Project-nested fixtures belong only to v1/plain-project migration.
      // Reject misplaced modern entries even when they would otherwise be ignored.
      const misplaced = [...unpacked.keys()].find(path => path.startsWith('project/fixtures/') || path.startsWith('fixtures/'));
      if (misplaced) throw new Error(`Misplaced managed fixture in Studio ZIP: ${misplaced}. Use the declared studio/fixtures namespace.`);
    }
    if (version === 3) {
      if (manifest.datasetMetadataVersion !== 1 || !Array.isArray(manifest.fixtureFiles)) throw new Error('Unsupported dataset metadata contract');
      const actual = [...unpacked.keys()].filter(p => p.startsWith('studio/fixtures/')).sort();
      const declared = manifest.fixtureFiles!.map(p => `studio/${p}`).sort();
      if (JSON.stringify(actual) !== JSON.stringify(declared) || manifest.fixtureFiles!.some(p => !validFixturePath(p))) throw new Error('Dataset manifest does not match fixture contents');
      for (const p of declared) if (!manifest.sha256?.[p]) throw new Error(`Missing integrity hash: ${p}`);
      for (const p of manifest.fixtureFiles!.filter(p => /\.(csv|xlsx)$/.test(p))) if (!manifest.fixtureFiles!.includes(p.replace(/\.(csv|xlsx)$/, '.dataset.json'))) throw new Error('Dataset metadata missing');
    }
    if (manifest.sha256) for (const [path, expected] of Object.entries(manifest.sha256)) {
      const bytes = unpacked.get(path);
      if (!bytes || await sha256(bytes) !== expected) throw new Error(`ZIP integrity check failed: ${path}`);
    }
    prefix = 'project/';
    if (version >= 2) {
      const metadata = JSON.parse(toText(unpacked.get('studio/chats.json') || toBytes('[]'))) as ChatMeta[];
      if (!Array.isArray(metadata)) throw new Error('Invalid chat metadata');
      chats = metadata.map(item => ({ ...item, chat: [], tools: [], agentMessages: [] }));
      const byId = new Map(chats.map(chat => [chat.id, chat]));
      for (const { chatId, ...line } of readLines<ChatLine & { chatId: string }>('studio/chat.jsonl')) byId.get(chatId)?.chat.push(line);
      for (const { chatId, ...line } of readLines<ToolLine & { chatId: string }>('studio/tool-events.jsonl')) byId.get(chatId)?.tools.push(line);
      activeChatId = manifest.activeChatId || '';
    } else {
      const legacy = newStudioChat();
      legacy.chat = readLines<ChatLine>('studio/chat.jsonl');
      legacy.tools = readLines<ToolLine>('studio/tool-events.jsonl');
      legacy.title = titleForChat(legacy.chat.find(line => line.role === 'user')?.text || 'Imported chat');
      chats = [legacy];
      activeChatId = legacy.id;
    }
  } else if (!unpacked.has('index.html')) {
    const candidates = [...unpacked.keys()].filter(path => path.endsWith('/index.html'));
    if (candidates.length === 1) prefix = candidates[0].slice(0, -'index.html'.length);
  }
  const files: FileMap = new Map();
  const fixtures: FileMap = new Map();
  for (const [path, bytes] of unpacked) {
    if (version >= 2 && path.startsWith('studio/fixtures/')) {
      const relative = path.slice('studio/'.length);
      if (validFixturePath(relative)) fixtures.set(relative, bytes);
    }
    if (path.startsWith(prefix)) {
      const relative = path.slice(prefix.length);
      if (version < 2 && validFixturePath(relative)) fixtures.set(relative, bytes);
      else if (relative && relative !== 'fixture-seed.js' && validProjectPath(relative)) files.set(relative, bytes);
    }
  }
  if (!files.has('index.html')) throw new Error('ZIP has no index.html entry point');
  if (!chats.length) chats = [newStudioChat()];
  if (!chats.some(chat => chat.id === activeChatId)) activeChatId = chats[0].id;
  return { files, fixtures: await migrateDatasets(fixtures), chats, activeChatId };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
