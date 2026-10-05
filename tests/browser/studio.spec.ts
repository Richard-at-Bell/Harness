import { test, expect, type Page } from '@playwright/test';
const accepted = (page: Page, path = 'app.js') => page.evaluate(path => (window as any).__studioTest.runtime.workspace.text(path), path);
const modelText = (page: Page, path = 'app.js') => page.evaluate(path => (window as any).__studioTest.modelValues().find((m: any) => m.uri.endsWith(`/${path}`))?.text, path);
async function type(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Editor content', exact: true }).focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); await page.keyboard.insertText(text);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/harness.html');
  await expect(page.locator('.monaco-editor')).toBeVisible();
});
test('typing, navigation and undo retain the same models until teardown', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.stack || e.message));
  const original = await accepted(page);
  await type(page, '//navigation_undo');
  await expect.poll(() => accepted(page)).toContain('navigation_undo');
  const position = await page.evaluate(() => (window as any).__studioTest.editorViews()[0].position);
  const originalUri = await page.evaluate(() => (window as any).__studioTest.modelValues().find((m: any) => m.uri.endsWith('/app.js')).uri);
  await page.getByRole('button', { name: 'styles.css' }).click();
  await page.getByRole('button', { name: 'app.js' }).click();
  await page.getByTitle('Preview', { exact: true }).click();
  await expect(page.locator('.editor-pane')).toBeHidden();
  await page.getByRole('button', { name: 'Studio data', exact: true }).click();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByTitle('Code', { exact: true }).click();
  await expect.poll(() => modelText(page)).toContain('navigation_undo');
  expect(await page.evaluate(() => (window as any).__studioTest.editorViews()[0].position)).toEqual(position);
  await page.getByRole('textbox', { name: 'Editor content', exact: true }).focus(); await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => accepted(page)).toBe(original);
  expect(await page.evaluate(() => (window as any).__studioTest.modelValues().find((m: any) => m.uri.endsWith('/app.js')).uri)).toBe(originalUri);
  await page.evaluate(() => (window as any).__studioTest.dispose());
  expect(await page.evaluate(() => (window as any).__studioTest.modelValues().length)).toBe(0);
  expect(errors).toEqual([]);
});
test('a failed save survives navigation, then retries into durable storage', async ({ page }) => {
  await page.evaluate(() => (window as any).__studioTest.fault('activation'));
  await type(page, '\n// recoverable');
  await expect(page.getByRole('button', { name: 'Unsaved · Retry' })).toBeVisible();
  expect(await accepted(page)).not.toContain('recoverable');
  await page.getByRole('button', { name: 'styles.css' }).click(); await page.getByRole('button', { name: 'app.js' }).click();
  await expect.poll(() => modelText(page)).toContain('recoverable');
  await page.evaluate(() => (window as any).__studioTest.fault());
  await page.getByRole('button', { name: 'Unsaved · Retry' }).click();
  await expect.poll(() => accepted(page)).toContain('recoverable');
  await expect(page.getByRole('button', { name: 'Unsaved · Retry' })).toHaveCount(0);
  await page.reload(); await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect.poll(() => modelText(page)).toContain('recoverable');
});
test('controlled agent changes conflict with failed file input without erasing it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => (window as any).__studioTest.fault('before-activation'));
  await type(page, '\n// my draft');
  await expect(page.getByRole('button', { name: 'Unsaved · Retry' })).toBeVisible();
  await page.evaluate(async () => { const c = (window as any).__studioTest; c.fault(); await c.agentFile('app.js', '// agent accepted'); });
  await expect(page.getByRole('alert').filter({ hasText: 'Draft conflicts' })).toBeVisible();
  await expect.poll(() => modelText(page)).toContain('my draft');
  expect(await accepted(page)).toBe('// agent accepted');
  await page.getByRole('button', { name: 'Copy draft', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('my draft');
  await page.getByRole('button', { name: 'Reload accepted', exact: true }).click();
  await expect.poll(() => modelText(page)).toBe('// agent accepted');
});
test('table drafts survive preview changes and navigation, then reload explicitly', async ({ page }) => {
  await page.getByRole('button', { name: 'Studio data', exact: true }).click();
  const title = page.locator('.table-scroll tbody tr').first().locator('input').nth(1);
  await expect(title).toHaveValue('Original'); await title.fill('My table draft');
  await page.getByRole('button', { name: /^other/ }).click(); await page.getByRole('button', { name: /^todos/ }).click();
  await expect(title).toHaveValue('My table draft');
  await page.evaluate(() => { const r = (window as any).__studioTest.runtime; return r.tableRequest(r.generation, 'todos', 'insert', { id: 'preview', title: 'Preview row' }, () => true); });
  await expect(page.getByRole('alert').filter({ hasText: 'Accepted table changed' })).toBeVisible();
  await expect(title).toHaveValue('My table draft'); await expect(page.getByRole('button', { name: 'Save table', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload accepted', exact: true }).click();
  await expect(title).toHaveValue('Original'); await expect(page.locator('.table-scroll tbody tr')).toHaveCount(2);
});
test('failed replacement retains editor recovery and successful activation disposes old models', async ({ page }) => {
  await page.evaluate(() => (window as any).__studioTest.fault('activation'));
  await type(page, '\n// retain across failed reset');
  await expect(page.getByRole('button', { name: 'Unsaved · Retry' })).toBeVisible();
  const originalUris = await page.evaluate(() => (window as any).__studioTest.modelValues().map((m: any) => m.uri));
  const failed = await page.evaluate(async () => { const c = (window as any).__studioTest; try { await c.runtime.resetProject(); } catch { } return { generation: c.runtime.generation, phase: c.runtime.phase }; });
  expect(failed).toEqual({ generation: 0, phase: 'failed' });
  await expect.poll(() => modelText(page)).toContain('retain across failed reset');
  await page.evaluate(async () => { const c = (window as any).__studioTest; c.fault(); await c.runtime.resetProject(); });
  await expect.poll(() => page.evaluate(uris => (window as any).__studioTest.modelValues().every((m: any) => !uris.includes(m.uri)), originalUris)).toBe(true);
  await expect(page.getByRole('button', { name: 'Unsaved · Retry' })).toHaveCount(0);
});

test('legacy OPFS migration is atomic and leaves the backup untouched', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { openDB } = await import('/node_modules/idb/build/index.js');
    const { Workspace, toText } = await import('/src/workspace.ts');
    const root = await navigator.storage.getDirectory();
    const project = await root.getDirectoryHandle('browser-project-studio-v1', { create: true });
    const fixtures = await project.getDirectoryHandle('fixtures', { create: true });
    async function put(dir: FileSystemDirectoryHandle, path: string, content: string) { const writer = await (await dir.getFileHandle(path, { create: true })).createWritable(); await writer.write(content); await writer.close(); }
    await put(project, 'index.html', 'Legacy project'); await put(fixtures, 'legacy.csv', 'id,title\n1,Legacy\n');
    const legacyDb = await openDB('browser-project-studio-v1', 1, { upgrade(db: any) { db.createObjectStore('meta'); } });
    await legacyDb.put('meta', { chat: [{ id: 'old', role: 'user', text: 'Legacy chat', time: '2026-01-01' }], modelId: 'legacy-model' }, 'session');
    await legacyDb.put('meta', false, 'review-agent-changes');
    const migrated = await Workspace.open();
    await put(project, 'index.html', 'Changed stale legacy backup');
    const reopened = await Workspace.open();
    const legacyFile = await (await fixtures.getFileHandle('legacy.csv')).getFile();
    return { project: migrated.text('index.html'), fixtures: toText(migrated.fixtures.get('fixtures/legacy.csv')!), chat: migrated.opened!.session.chats[0].chat[0].text, review: migrated.opened!.review, reopened: reopened.text('index.html'), backup: await legacyFile.text() };
  });
  expect(result).toEqual({ project: 'Legacy project', fixtures: 'id,title\n1,Legacy\n', chat: 'Legacy chat', review: false, reopened: 'Legacy project', backup: 'id,title\n1,Legacy\n' });
});

test('a second tab cannot silently overwrite the first tab revision', async ({ page, context }) => {
  const other = await context.newPage(); await other.goto('/tests/browser/harness.html');
  await expect(other.locator('.monaco-editor')).toBeVisible();
  await other.evaluate(() => (window as any).__studioTest.runtime.saveFile('styles.css', 'body { color: green; }'));
  await type(page, '//cross_tab_draft');
  await expect(page.getByRole('alert').filter({ hasText: 'Another tab' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen studio', exact: true })).toBeVisible();
  await expect.poll(() => modelText(page)).toContain('cross_tab_draft');
  expect(await accepted(other)).not.toContain('cross_tab_draft');
  expect(await accepted(other, 'styles.css')).toContain('green'); await other.close();
});

test('conversion failure keeps CSV active and a deliberate conversion retry succeeds', async ({ page }) => {
  await page.getByRole('button', { name: 'Studio data', exact: true }).click();
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1);
  await page.evaluate(() => (window as any).__studioTest.fault('activation'));
  await page.getByRole('button', { name: 'Convert to XLSX', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Injected storage failure' })).toBeVisible();
  expect(await page.evaluate(() => [...(window as any).__studioTest.runtime.workspace.fixtures.keys()])).toContain('fixtures/todos.csv');
  expect(await page.evaluate(() => [...(window as any).__studioTest.runtime.workspace.fixtures.keys()])).not.toContain('fixtures/todos.xlsx');
  await page.evaluate(() => (window as any).__studioTest.fault());
  await page.getByRole('button', { name: 'Convert to XLSX', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Convert to CSV', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...(window as any).__studioTest.runtime.workspace.fixtures.keys()])).not.toContain('fixtures/todos.csv');
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1);
});
