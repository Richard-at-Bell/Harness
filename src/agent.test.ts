import { describe, expect, it } from 'vitest';
import { createTools } from './agent';
import { readTable, tableBytes, type Table } from './fixtures';
import { Stage } from './workspace';

describe('agent fixture tools', () => {
  it('reads and stages an XLSX table edit without changing the accepted bytes', async () => {
    const table: Table = { path: 'fixtures/todos.xlsx', format: 'xlsx', columns: ['id', 'title', 'completed'], rows: [{ id: '1', title: 'Original', completed: false }] };
    const original = await tableBytes(table);
    const stage = new Stage(new Map(), 1, new Map([[table.path, original]]));
    const tools = createTools(stage);
    const projectList = await tools.find(tool => tool.name === 'list_files')!.execute('files', {});
    const tableList = await tools.find(tool => tool.name === 'list_tables')!.execute('tables', {});
    expect(JSON.stringify(projectList)).not.toContain('todos.xlsx');
    expect(JSON.stringify(tableList)).toContain('todos');
    const read = tools.find(tool => tool.name === 'read_table')!;
    const write = tools.find(tool => tool.name === 'write_table')!;
    const result = await read.execute('read', { table: 'todos' });
    expect(JSON.stringify(result)).toContain('Original');
    await write.execute('write', { table: 'todos', rows: [{ id: '1', title: 'Changed', completed: true, priority: 'high', due_date: '2026-10-02' }] });
    expect(stage.changes()).toEqual([table.path]);
    expect((await readTable(stage.fixtures, 'todos')).rows[0].title).toBe('Changed');
    expect((await readTable(stage.fixtures, 'todos')).columns).toEqual(['id', 'title', 'completed', 'priority', 'due_date']);
    expect((await readTable(stage.fixtures, 'todos')).rows[0]).toMatchObject({ priority: 'high', due_date: '2026-10-02' });
    expect((await readTable(stage.fixtureBaseline, 'todos')).rows[0].title).toBe('Original');
  });
});
