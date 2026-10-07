import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { readTable } from './fixtures';
import { exportZip, importZip } from './export';
import { newStudioChat, toBytes, toText, type ChatLine, type FileMap, type ToolLine } from './workspace';

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
