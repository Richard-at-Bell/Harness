import { describe, expect, it } from 'vitest';
import { exportZip, importZip } from './export';
import { toBytes, toText, type ChatLine, type FileMap, type ToolLine } from './workspace';

describe('project ZIP', () => {
  it('round trips project files, chat, and tool events', async () => {
    const files: FileMap = new Map([
      ['index.html', toBytes('<!doctype html><title>Demo</title>')],
      ['app.js', toBytes('console.log("ready")')],
      ['fixtures/todos.csv', toBytes('id,title,completed\n1,First,false\n')],
    ]);
    const chat: ChatLine[] = [{ id: 'one', role: 'user', text: 'Make a to-do app', time: '2026-09-28T00:00:00.000Z' }];
    const tools: ToolLine[] = [{ id: 'tool-one', name: 'edit_file', status: 'ok', summary: 'Completed', time: '2026-09-28T00:00:01.000Z' }];
    const zip = await exportZip(files, chat, tools);
    const imported = await importZip(zip);
    expect([...imported.files.keys()].sort()).toEqual([...files.keys(), 'README.md'].sort());
    for (const [path, bytes] of files) expect(toText(imported.files.get(path)!)).toBe(toText(bytes));
    expect(imported.chat).toEqual(chat);
    expect(imported.tools).toEqual(tools);
  });
});
