import { describe, expect, it } from 'vitest';
import { createTools } from './agent';
import { readTable, tableBytes, type Table } from './fixtures';
import { Stage } from './workspace';

describe('agent fixture tools', () => {
  it('reads and stages an XLSX table edit without changing the accepted bytes', async () => {
    const table: Table = { path: 'fixtures/todos.xlsx', format: 'xlsx', columns: ['id', 'title', 'completed'], rows: [{ id: '1', title: 'Original', completed: false }] };
    const original = await tableBytes(table);
    const stage = new Stage(new Map([[table.path, original]]), 1);
    const tools = createTools(stage);
    const read = tools.find(tool => tool.name === 'read_table')!;
    const write = tools.find(tool => tool.name === 'write_table')!;
    const result = await read.execute('read', { table: 'todos' });
    expect(JSON.stringify(result)).toContain('Original');
    await write.execute('write', { table: 'todos', rows: [{ id: '1', title: 'Changed', completed: true }] });
    expect(stage.changes()).toEqual([table.path]);
    expect((await readTable(stage.files, 'todos')).rows[0].title).toBe('Changed');
    expect((await readTable(stage.baseline, 'todos')).rows[0].title).toBe('Original');
  });
});
