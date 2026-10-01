import { describe, expect, it } from 'vitest';
import { fixtureIds, generateRows, readTable, tableBytes, type Table } from './fixtures';
import { Stage, type FileMap } from './workspace';

describe('fixture tables', () => {
  it('round trips CSV and XLSX with the same schema and rows', async () => {
    const source: Table = {
      path: 'fixtures/todos.csv', format: 'csv', columns: ['id', 'title', 'completed'],
      rows: [{ id: 'one', title: 'Write, review', completed: false }, { id: 'two', title: 'Ship it', completed: true }],
    };
    const csv = await tableBytes(source);
    const files: FileMap = new Map([[source.path, csv]]);
    expect(fixtureIds(files)).toEqual(['todos']);
    expect(await readTable(files, 'todos')).toEqual(source);

    const xlsx: Table = { ...source, path: 'fixtures/todos.xlsx', format: 'xlsx' };
    const spreadsheet = await tableBytes(xlsx);
    const parsed = await readTable(new Map([[xlsx.path, spreadsheet]]), 'todos');
    expect(parsed.columns).toEqual(source.columns);
    expect(parsed.rows).toEqual(source.rows);
  });

  it('generates repeatable rows from a seed and column schema', () => {
    const table: Table = { path: 'fixtures/todos.csv', format: 'csv', columns: ['id', 'title', 'completed'], rows: [] };
    expect(generateRows(table, 17, 5)).toEqual(generateRows(table, 17, 5));
    expect(generateRows(table, 18, 5)).not.toEqual(generateRows(table, 17, 5));
    expect(generateRows(table, 17, 5)).toHaveLength(5);
  });

  it.each(['csv', 'xlsx'] as const)('preserves new preview fields through %s saves and later edits', async format => {
    const table: Table = { path: `fixtures/todos.${format}`, format, columns: ['id', 'title', 'completed'], rows: [
      { id: 'one', title: 'Existing task', completed: false, priority: 'low', due_date: '2026-10-02' },
      { id: 'two', title: 'Older task', completed: true },
    ] };
    const files = new Map([[table.path, await tableBytes(table)]]);
    const saved = await readTable(files, 'todos');
    expect(saved.columns).toEqual(['id', 'title', 'completed', 'priority', 'due_date']);
    expect(saved.rows[0]).toMatchObject({ priority: 'low', due_date: '2026-10-02' });
    saved.rows[0].title = 'Renamed task';
    files.set(table.path, await tableBytes(saved));
    expect((await readTable(files, 'todos')).rows[0]).toMatchObject({ title: 'Renamed task', priority: 'low', due_date: '2026-10-02' });
  });

  it('rejects nested values instead of serializing them into broken table cells', async () => {
    const table: Table = { path: 'fixtures/todos.csv', format: 'csv', columns: ['id'], rows: [{ id: 'one', priority: { value: 'low' } as never }] };
    await expect(tableBytes(table)).rejects.toThrow('Invalid priority value');
  });

  it('detects changed spreadsheet bytes in a staged agent turn', () => {
    const stage = new Stage(new Map(), 1, new Map([['fixtures/todos.xlsx', new Uint8Array([1, 2, 3])]]));
    stage.writeFixtureBytes('fixtures/todos.xlsx', new Uint8Array([1, 2, 4]));
    expect(stage.changes()).toEqual(['fixtures/todos.xlsx']);
  });
});
