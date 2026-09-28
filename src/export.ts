import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import type { ChatLine, FileMap, ToolLine } from './workspace';
import { toBytes, toText, validPath } from './workspace';
import { seedScript } from './fixtures';

type ExportManifest = { format: 'browser-project-studio'; version: 1; exportedAt: string; entry: string; files: string[]; sha256: Record<string, string> };

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function exportZip(files: FileMap, chat: ChatLine[], tools: ToolLine[]): Promise<Blob> {
  const archive = new ZipWriter(new BlobWriter('application/zip'));
  const paths = [...files.keys()].filter(path => path !== 'fixture-seed.js').sort();
  const hashes: Record<string, string> = {};
  async function add(path: string, bytes: Uint8Array) { await archive.add(path, new Uint8ArrayReader(bytes)); hashes[path] = await sha256(bytes); }
  for (const path of paths) await add(`project/${path}`, files.get(path)!);
  await add('project/fixture-seed.js', toBytes(await seedScript(files)));
  const readme = `# Project\n\nServe this folder with any static file server, then open index.html. The fixture file in fixtures/ contains the starting table. While running outside the studio, changes are saved in that browser's local storage; the page can call StudioData.download('todos') to download the latest rows as CSV. A static site cannot silently rewrite the source fixture file on disk.\n`;
  if (!files.has('README.md')) await add('project/README.md', toBytes(readme));
  const manifest: ExportManifest = { format: 'browser-project-studio', version: 1, exportedAt: new Date().toISOString(), entry: 'project/index.html', files: [...new Set([...paths, 'fixture-seed.js', 'README.md'])], sha256: hashes };
  await archive.add('manifest.json', new Uint8ArrayReader(toBytes(JSON.stringify(manifest, null, 2))));
  await archive.add('studio/chat.jsonl', new Uint8ArrayReader(toBytes(chat.map(line => JSON.stringify(line)).join('\n') + '\n')));
  await archive.add('studio/tool-events.jsonl', new Uint8ArrayReader(toBytes(tools.map(line => JSON.stringify(line)).join('\n') + '\n')));
  return archive.close();
}

export async function importZip(blob: Blob): Promise<{ files: FileMap; chat: ChatLine[]; tools: ToolLine[] }> {
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
  let chat: ChatLine[] = [], tools: ToolLine[] = [];
  if (unpacked.has('manifest.json')) {
    const manifest = JSON.parse(toText(unpacked.get('manifest.json')!)) as ExportManifest;
    if (manifest.format !== 'browser-project-studio' || manifest.version !== 1) throw new Error('Unsupported studio ZIP version');
    if (manifest.sha256) for (const [path, expected] of Object.entries(manifest.sha256)) {
      const bytes = unpacked.get(path);
      if (!bytes || await sha256(bytes) !== expected) throw new Error(`ZIP integrity check failed: ${path}`);
    }
    prefix = 'project/';
    const readLines = <T>(path: string): T[] => toText(unpacked.get(path) || new Uint8Array()).split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
    chat = readLines<ChatLine>('studio/chat.jsonl');
    tools = readLines<ToolLine>('studio/tool-events.jsonl');
  } else if (!unpacked.has('index.html')) {
    const candidates = [...unpacked.keys()].filter(path => path.endsWith('/index.html'));
    if (candidates.length === 1) prefix = candidates[0].slice(0, -'index.html'.length);
  }
  const files: FileMap = new Map();
  for (const [path, bytes] of unpacked) {
    if (path.startsWith(prefix)) {
      const relative = path.slice(prefix.length);
      if (relative && relative !== 'fixture-seed.js' && !relative.startsWith('studio/') && validPath(relative)) files.set(relative, bytes);
    }
  }
  if (!files.has('index.html')) throw new Error('ZIP has no index.html entry point');
  return { files, chat, tools };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
