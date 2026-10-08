import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { StudioRuntime } from './studioRuntime';
import { memoryStorage } from './workspaceStorage';
import { readTable } from './fixtures';
import { exportZip, importZip } from './export';
import { newStudioChat, toBytes, toText, Workspace, type ChatLine, type FileMap, type ToolLine } from './workspace';

describe('project ZIP', () => {
  it('keeps fixtures in Studio and round trips multiple chats', async () => {
    const files: FileMap = new Map([
      ['index.html', toBytes('<!doctype html><title>Demo</title>')],
      ['app.js', toBytes('console.log("ready")')],
    ]);
    const fixtures: FileMap = new Map([
      ['fixtures/todos.csv', toBytes('id,title,completed\n1,First,false\n')],
    ]);
    const chat: ChatLine[] = [{ id: 'one', role: 'user', text: 'Make a to-do app', time: '2026-09-28T00:00:00.000Z' }];
    const tools: ToolLine[] = [{ id: 'tool-one', name: 'edit_file', status: 'ok', summary: 'Completed', time: '2026-09-28T00:00:01.000Z' }];
    const first = { ...newStudioChat(), title: 'Build app', chat, tools };
    const second = { ...newStudioChat(), title: 'Refine app', chat: [{ ...chat[0], id: 'two', text: 'Refine the layout' }], tools: [] };
    const zip = await exportZip(files, fixtures, [first, second], second.id);
    const reader = new ZipReader(new BlobReader(zip));
    const paths = (await reader.getEntries()).map(entry => entry.filename);
    await reader.close();
    expect(paths).toContain('studio/fixtures/todos.csv');
    expect(paths).not.toContain('project/fixtures/todos.csv');
    expect(paths).toContain('project/fixture-seed.js');
    const imported = await importZip(zip);
    expect([...imported.files.keys()].sort()).toEqual([...files.keys(), 'README.md'].sort());
    for (const [path, bytes] of files) expect(toText(imported.files.get(path)!)).toBe(toText(bytes));
    expect((await readTable(imported.fixtures, 'todos')).rows).toEqual((await readTable(fixtures, 'todos')).rows);
    expect(imported.fixtures.has('fixtures/todos.dataset.json')).toBe(true);
    expect(imported.chats.map(item => item.title)).toEqual(['Build app', 'Refine app']);
    expect(imported.chats[0].chat).toEqual(chat);
    expect(imported.chats[0].tools).toEqual(tools);
    expect(imported.chats[1].chat).toEqual(second.chat);
    expect(imported.activeChatId).toBe(second.id);
  });

  it('migrates a v1 project fixture and transcript into Studio data', async () => {
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    const add = (path: string, text: string) => writer.add(path, new Uint8ArrayReader(toBytes(text)));
    await add('manifest.json', JSON.stringify({ format: 'browser-project-studio', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', entry: 'project/index.html', files: ['index.html', 'fixtures/todos.csv'], sha256: {} }));
    await add('project/index.html', '<!doctype html><title>Old</title>');
    await add('project/fixtures/todos.csv', 'id,title\n1,Old\n');
    await add('studio/chat.jsonl', JSON.stringify({ id: 'one', role: 'user', text: 'Old chat', time: '2026-01-01T00:00:00.000Z' }) + '\n');
    const imported = await importZip(await writer.close());
    expect(imported.files.has('fixtures/todos.csv')).toBe(false);
    expect(toText(imported.fixtures.get('fixtures/todos.csv')!)).toContain('Old');
    expect(imported.chats[0].chat[0].text).toBe('Old chat');
  });
});

it('migrates a v2 Studio CSV with text codes and case-preserving names', async () => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  const add = (path: string, text: string) => writer.add(path, new Uint8ArrayReader(toBytes(text)));
  await add('manifest.json', JSON.stringify({ format: 'browser-project-studio', version: 2, files: ['index.html'], fixtureFiles: ['fixtures/JOBDATA.csv'], sha256: {} }));
  await add('project/index.html', '<h1>Legacy</h1>'); await add('studio/fixtures/JOBDATA.csv', 'Code,ActiveText\n0007,TRUE\n');
  const imported = await importZip(await writer.close()), table = await readTable(imported.fixtures, 'JOBDATA');
  expect(table.definition.name).toBe('JOBDATA'); expect(table.rows).toEqual([{ Code: '0007', ActiveText: 'TRUE' }]); expect(imported.fixtures.has('fixtures/JOBDATA.dataset.json')).toBe(true);
});


it('rejects misplaced modern fixtures and bad fixture hashes before workspace or session activation', async () => {
  const chat = { ...newStudioChat(), title: 'Keep this session' };
  const workspace = new Workspace(memoryStorage({}), new Map([['index.html', toBytes('<h1>Accepted</h1>')]]), new Map([['fixtures/JOBDATA.csv', toBytes('Code\n0007\n')]]));
  const studio = new StudioRuntime(workspace, { version: 2, chats: [chat], activeChatId: chat.id }, true);
  const archive = await studio.exportProject();
  const reader = new ZipReader(new BlobReader(archive));
  const entries: FileMap = new Map();
  try { for (const entry of await reader.getEntries()) if (!entry.directory) entries.set(entry.filename, await entry.getData!(new Uint8ArrayWriter())); }
  finally { await reader.close(); }
  const manifest = JSON.parse(toText(entries.get('manifest.json')!));
  const dataPath = 'studio/fixtures/JOBDATA.csv', metaPath = 'studio/fixtures/JOBDATA.dataset.json';
  async function repack(change: (files: FileMap, manifest: any) => void) {
    const files = new Map(entries), m = structuredClone(manifest); change(files, m);
    files.set('manifest.json', toBytes(JSON.stringify(m)));
    const writer = new ZipWriter(new BlobWriter('application/zip'));
    for (const [path, bytes] of files) await writer.add(path, new Uint8ArrayReader(bytes));
    return writer.close();
  }
  const before = workspace.store.getState(), session = studio.session.store.getState();
  const probes: [string, (files: FileMap, manifest: any) => void, RegExp][] = [
    ['undeclared CSV', files => files.set('project/fixtures/UNDECLARED.csv', toBytes('Code\n0007\n')), /Misplaced.*fixture/],
    ['undeclared metadata', files => files.set('project/fixtures/UNDECLARED.dataset.json', entries.get(metaPath)!), /Misplaced.*fixture/],
    ['data override', files => files.set('project/fixtures/JOBDATA.csv', toBytes('Code\n9999\n')), /Misplaced.*fixture/],
    ['metadata override', files => files.set('project/fixtures/JOBDATA.dataset.json', toBytes('{}')), /Misplaced.*fixture/],
    ['root fixture', files => files.set('fixtures/UNDECLARED.csv', toBytes('Code\n0007\n')), /Misplaced.*fixture/],
    ['v2 misplaced fixture', (files, m) => { m.version = 2; files.set('project/fixtures/JOBDATA.csv', toBytes('Code\n9999\n')); }, /Misplaced.*fixture/],
    ['missing data hash', (_files, m) => { delete m.sha256[dataPath]; }, /Missing integrity hash/],
    ['missing metadata hash', (_files, m) => { delete m.sha256[metaPath]; }, /Missing integrity hash/],
    ['mismatched data hash', files => files.set(dataPath, toBytes('Code\n9999\n')), /integrity check failed/],
    ['mismatched metadata hash', files => files.set(metaPath, toBytes('{}')), /integrity check failed/],
  ];
  try {
    for (const [label, change, error] of probes) {
      const zip = await repack(change);
      await expect(studio.importProject(new File([zip], label + '.zip')), label).rejects.toThrow(error);
      expect(workspace.store.getState(), label).toBe(before); expect(studio.session.store.getState(), label).toBe(session);
    }
    // Plain-project archives intentionally retain the project-nested migration path.
    const plain = new ZipWriter(new BlobWriter('application/zip'));
    await plain.add('plain/index.html', new Uint8ArrayReader(toBytes('<h1>Plain</h1>')));
    await plain.add('plain/fixtures/PLAIN.csv', new Uint8ArrayReader(toBytes('Code\n0007\n')));
    expect((await readTable((await importZip(await plain.close())).fixtures, 'PLAIN')).rows).toEqual([{ Code: '0007' }]);
  } finally { studio.stop(); }
});
