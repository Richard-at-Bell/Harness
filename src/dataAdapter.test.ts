import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { seedScript } from './fixtures';
import { DatasetService } from './datasetService';
import { Stage } from './workspace';
import { templateFixtures } from './template';
import { toBytes } from './workspace';
const adapter = readFileSync(new URL('../templates/todo/data-store.js', import.meta.url), 'utf8');
async function standalone(fixtures: Map<string, Uint8Array>) {
  const storage = new Map(), listeners: any[] = [];
  const sandbox: any = { crypto, structuredClone, Date, console, setTimeout, clearTimeout, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key,value) }, addEventListener: (_type: string, listener: any) => listeners.push(listener) };
  sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(await seedScript(fixtures), sandbox); vm.runInContext(adapter, sandbox);
  return { data: sandbox.StudioData, storage, sandbox };
}
describe('portable authored StudioData adapter', () => {
  it('runs the exported kernel with typed handles, constraints and failure rollback in a standalone site', async () => {
    const stage = new Stage(new Map(), 0);
    const service = new DatasetService({ fixtures: stage.fixtures, async writeFixture(p,b) { stage.writeFixtureBytes(p,b); }, async removeFixture(p) { stage.fixtures.delete(p); } });
    const table = await service.create({ name: 'JOBDATA', fields: [{ name: 'Code', type: 'text', nullable: false }, { name: 'Amount', type: 'number', nullable: true }], rows: [{ Code: '0007', Amount: 12.5 }, { Code: '0007', Amount: null }] });
    const { data, storage } = await standalone(stage.fixtures);
    const page = await data.page('JOBDATA'); expect(page.definition.id).toBe(table.definition.id); expect(page.rows).toEqual(table.rows);
    await data.update('JOBDATA', page.handles[1], { Amount: 20 }, { revision: page.revision });
    expect((await data.list('JOBDATA')).map((r: any) => r.Amount)).toEqual([12.5,20]);
    const before = [...storage];
    await expect(data.update('JOBDATA', page.handles[1], { Amount: '20' })).rejects.toThrow('expected number'); expect([...storage]).toEqual(before);
    await expect(data.update('JOBDATA', page.handles[0], { Amount: 30 }, { revision: page.revision })).rejects.toThrow('revision');
    await data.remove('JOBDATA', page.handles[1]); expect((await data.list('JOBDATA'))).toHaveLength(1);
    await data.insert('JOBDATA', { Code: 'TRUE', Amount: null }); expect((await data.list('JOBDATA'))[1].Code).toBe('TRUE');
  });
  it('preserves list/insert/update/remove/subscribe to-do calls and migrates old local row arrays', async () => {
    const { data, storage, sandbox } = await standalone(new Map(Object.entries(templateFixtures).map(([p,text]) => [p,toBytes(text)])));
    let notifications = 0; const off = data.subscribe('todos', () => notifications++);
    const inserted = await data.insert('todos', { title: 'Authored call' }); expect(inserted.id).toBeTruthy(); expect(inserted.completed).toBe(false);
    await data.update('todos', inserted.id, { completed: true }); await data.remove('todos', inserted.id); expect(notifications).toBe(3); off();
    storage.set('browser-project-studio:todos:todos', JSON.stringify([{ id: 'old', title: 'Old saved array', completed: false, created_at: '2026-10-07T12:00:00Z' }]));
    sandbox.StudioData = undefined; vm.runInContext(adapter, sandbox);
    expect((await sandbox.StudioData.list('todos'))[0].title).toBe('Old saved array');
    await sandbox.StudioData.update('todos', 'old', { completed: true }); expect((await sandbox.StudioData.list('todos'))[0].completed).toBe(true);
  });
});
