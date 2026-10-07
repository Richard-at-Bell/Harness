import { describe, expect, it } from 'vitest';
import { createTools } from './agent';
import { applyAgentChange } from './agentChanges';
import { readTable } from './fixtures';
import { Stage, toBytes, toText } from './workspace';

function memoryWorkspace() {
  return {
    files: new Map<string, Uint8Array>([['index.html', toBytes('<h1>Original</h1>')], ['styles.css', toBytes('body { color: black; }')]]),
    fixtures: new Map<string, Uint8Array>([['fixtures/todos.csv', toBytes('id,title,completed\n1,Original,false\n')]]),
    async write(path: string, bytes: Uint8Array) { this.files.set(path, bytes); },
    async remove(path: string) { this.files.delete(path); },
    async writeFixture(path: string, bytes: Uint8Array) { this.fixtures.set(path, bytes); },
    async removeFixture(path: string) { this.fixtures.delete(path); },
  };
}

describe('automatic agent edits', () => {
  it('applies each file and fixture tool before it returns, preserving other files', async () => {
    const workspace = memoryWorkspace();
    const stage = new Stage(new Map(workspace.files), 0, new Map(workspace.fixtures));
    const tools = createTools(stage, {
      beforeTool: async () => { stage.files = new Map(workspace.files); stage.fixtures = new Map(workspace.fixtures); },
      onChange: async change => { await applyAgentChange(workspace, change); },
    });
    const call = (name: string, input: object) => tools.find(tool => tool.name === name)!.execute(name, input);
    await call('write_file', { path: 'about.html', content: '<h1>About</h1>' });
    expect(toText(workspace.files.get('about.html')!)).toContain('About');
    workspace.files.set('styles.css', toBytes('body { color: blue; }'));
    await call('edit_file', { path: 'index.html', oldText: 'Original', newText: 'Applied' });
    expect(toText(workspace.files.get('index.html')!)).toContain('Applied');
    expect(toText(workspace.files.get('styles.css')!)).toContain('blue');
    await call('write_table', { table: 'todos', rows: [{ id: '1', title: 'Applied row', completed: false, priority: 'high' }] });
    expect((await readTable(workspace.fixtures, 'todos')).rows[0]).toMatchObject({ title: 'Applied row', priority: 'high' });
    await call('delete_file', { path: 'about.html' });
    expect(workspace.files.has('about.html')).toBe(false);
    expect(toText(stage.baseline.get('index.html')!)).toContain('Original');
  });

  it('rejects a concurrent edit to the same path and removes the failed staged edit', async () => {
    const workspace = memoryWorkspace();
    const stage = new Stage(new Map(workspace.files), 0);
    const tools = createTools(stage, { onChange: async change => { await applyAgentChange(workspace, change); } });
    workspace.files.set('index.html', toBytes('<h1>User edit</h1>'));
    await expect(tools.find(tool => tool.name === 'edit_file')!.execute('edit', { path: 'index.html', oldText: 'Original', newText: 'Agent edit' })).rejects.toThrow('changed while the agent was editing');
    expect(toText(workspace.files.get('index.html')!)).toContain('User edit');
    expect(stage.changes()).toEqual([]);
  });

  it('keeps edits staged with review on and rolls back a failed automatic save', async () => {
    const workspace = memoryWorkspace();
    const stage = new Stage(new Map(workspace.files), 0);
    await createTools(stage).find(tool => tool.name === 'write_file')!.execute('review', { path: 'index.html', content: 'Review me' });
    expect(toText(workspace.files.get('index.html')!)).toContain('Original');
    expect(stage.text('index.html')).toBe('Review me');
    const failed = new Stage(new Map(workspace.files), 0);
    const tools = createTools(failed, { onChange: async () => { throw new Error('Storage full'); } });
    await expect(tools.find(tool => tool.name === 'write_file')!.execute('failed', { path: 'new.html', content: 'Unsaved' })).rejects.toThrow('Storage full');
    expect(failed.changes()).toEqual([]);
    expect(workspace.files.has('new.html')).toBe(false);
  });

  it('commits new fixtures automatically and removes a creation when persistence fails', async () => {
    const workspace = memoryWorkspace();
    const stage = new Stage(new Map(workspace.files), 0, new Map(workspace.fixtures));
    const create = createTools(stage, { onChange: async change => { await applyAgentChange(workspace, change); } }).find(tool => tool.name === 'create_table')!;
    await create.execute('create', { table: 'meals', columns: ['id', 'food'], rows: [{ id: '1', food: 'Sample meal' }] });
    expect((await readTable(workspace.fixtures, 'meals')).rows[0].food).toBe('Sample meal');
    expect(workspace.fixtures.has('fixtures/todos.csv')).toBe(true);
    const failed = new Stage(new Map(workspace.files), 0, new Map(workspace.fixtures));
    const failingCreate = createTools(failed, { onChange: async () => { throw new Error('Storage full'); } }).find(tool => tool.name === 'create_table')!;
    await expect(failingCreate.execute('failed', { table: 'settings', columns: ['id'] })).rejects.toThrow('Storage full');
    expect(failed.changes()).toEqual([]);
    expect(workspace.fixtures.has('fixtures/settings.csv')).toBe(false);
  });

  it('rejects a new fixture when another format of that table was created concurrently', async () => {
    const workspace = memoryWorkspace();
    const stage = new Stage(new Map(workspace.files), 0, new Map(workspace.fixtures));
    const tools = createTools(stage, { onChange: async change => {
      workspace.fixtures.set('fixtures/meals.xlsx', toBytes('concurrent workbook'));
      await applyAgentChange(workspace, change);
    } });
    await expect(tools.find(tool => tool.name === 'create_table')!.execute('create', { table: 'meals', columns: ['id'] })).rejects.toThrow('already exists');
    expect(stage.changes()).toEqual([]);
    expect(workspace.fixtures.has('fixtures/meals.csv')).toBe(false);
    expect(toText(workspace.fixtures.get('fixtures/meals.xlsx')!)).toBe('concurrent workbook');
  });
});
