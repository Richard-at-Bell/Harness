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

  it('detects changed spreadsheet bytes in a staged agent turn', () => {
    const stage = new Stage(new Map([['fixtures/todos.xlsx', new Uint8Array([1, 2, 3])]]), 1);
    stage.writeBytes('fixtures/todos.xlsx', new Uint8Array([1, 2, 4]));
    expect(stage.changes()).toEqual(['fixtures/todos.xlsx']);
  });
});
