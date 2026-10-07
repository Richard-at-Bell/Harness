import { describe, expect, it } from 'vitest';
import { createTools } from './agent';
import { readTable, metadataPath, tableBytes, type Table } from './fixtures';
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
    await write.execute('write', { table: 'todos', replaceAll: true, revision: 0, rows: [{ id: '1', title: 'Changed', completed: true, priority: 'high', due_date: '2026-10-02' }] });
    expect(stage.changes()).toEqual([metadataPath(table.path), table.path].sort());
    expect((await readTable(stage.fixtures, 'todos')).rows[0].title).toBe('Changed');
    expect((await readTable(stage.fixtures, 'todos')).columns).toEqual(['id', 'title', 'completed', 'priority', 'due_date']);
    expect((await readTable(stage.fixtures, 'todos')).rows[0]).toMatchObject({ priority: 'high', due_date: '2026-10-02' });
    expect((await readTable(stage.fixtureBaseline, 'todos')).rows[0].title).toBe('Original');
  });

  it.each(['csv', 'xlsx'] as const)('creates a staged %s fixture that can be listed, read, and updated', async format => {
    const stage = new Stage(new Map(), 1);
    const tools = createTools(stage);
    const call = (name: string, input: object) => tools.find(tool => tool.name === name)!.execute(name, input);
    await call('create_table', { table: 'meals', format, columns: ['id', 'food', 'calories'], rows: [{ id: 'meal-1', food: 'Sample lunch', calories: 420, protein: 25 }] });
    const created = await readTable(stage.fixtures, 'meals');
    expect(stage.changes()).toEqual([created.path, metadataPath(created.path)].sort());
    expect(stage.files.size).toBe(0);
    expect(stage.fixtureBaseline.size).toBe(0);
    expect(JSON.stringify(await call('list_tables', {}))).toContain('meals');
    expect(JSON.stringify(await call('read_table', { table: 'meals' }))).toContain('Sample lunch');
    const table = await readTable(stage.fixtures, 'meals');
    expect(table.columns).toEqual(['id', 'food', 'calories', 'protein']);
    expect(Number(table.rows[0].calories)).toBe(420);
    await call('write_table', { table: 'meals', replaceAll: true, revision: table.revision, rows: [{ ...table.rows[0], calories: 500 }] });
    expect(Number((await readTable(stage.fixtures, 'meals')).rows[0].calories)).toBe(500);
  });

  it('creates an empty table with its declared columns', async () => {
    const stage = new Stage(new Map(), 1);
    await createTools(stage).find(tool => tool.name === 'create_table')!.execute('create', { table: 'settings', columns: ['id', 'calorie_goal'] });
    expect(await readTable(stage.fixtures, 'settings')).toMatchObject({ columns: ['id', 'calorie_goal'], rows: [], format: 'csv' });
  });

  it('rejects duplicate table identities and invalid creation without changing any bytes', async () => {
    const original = await tableBytes({ path: 'fixtures/meals.csv', format: 'csv', columns: ['id'], rows: [{ id: 'original' }] });
    const stage = new Stage(new Map(), 1, new Map([['fixtures/meals.csv', original]]));
    const create = createTools(stage).find(tool => tool.name === 'create_table')!;
    await expect(create.execute('duplicate', { table: 'meals', format: 'xlsx', columns: ['id'] })).rejects.toThrow('already exists');
    for (const input of [
      { table: '../escape', columns: ['id'] },
      { table: 'empty', columns: [] },
      { table: 'blank', columns: ['id', ' '] },
      { table: 'duplicate', columns: ['id', 'id'] },
      { table: 'bad_format', columns: ['id'], format: 'json' },
      { table: 'bad_row', columns: ['id'], rows: [null] },
      { table: 'nested', columns: ['id'], rows: [{ id: { nested: true } }] },
      { table: 'infinite', columns: ['id'], rows: [{ id: Infinity }] },
      { table: 'too_many', columns: ['id'], rows: Array.from({ length: 1001 }, () => ({ id: 'x' })) },
    ]) await expect(create.execute('invalid', input)).rejects.toThrow();
    expect(stage.changes()).toEqual([]);
    expect(stage.fixtures.get('fixtures/meals.csv')).toEqual(original);
  });
});
