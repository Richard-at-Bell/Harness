import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4318/tests/browser/harness.html');
const result = await page.evaluate(async () => {
  const { IndexedWorkspaceStorage } = await import('/src/workspaceStorage.ts');
  const { newStudioChat, Workspace } = await import('/src/workspace.ts');
  const chat = newStudioChat();
  const name = `benchmark-${crypto.randomUUID()}`;
  const storage = await IndexedWorkspaceStorage.connect(name);
  const files = new Map(Array.from({ length: 5 }, (_, i) => [`asset-${i}.bin`, crypto.getRandomValues(new Uint8Array(65536))]));
  // 5 x 20 MB models the 100 MB decompressed ZIP ceiling, without a giant file.
  for (const path of files.keys()) { const bytes = new Uint8Array(20_000_000); for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i+65536, bytes.length))); files.set(path, bytes); }
  const start = performance.now();
  await storage.initialize({ files, fixtures: new Map(), session: { version: 2, chats: [chat], activeChatId: chat.id }, review: true, identity: crypto.randomUUID(), selection: { file: 'asset-0.bin', tableId: '', tab: 'files' } });
  const initialized = performance.now();
  const record = await storage.load();
  const loaded = performance.now();
  const workspace = new Workspace(storage, record.files, record.fixtures, record);
  const ready = performance.now();
  await workspace.write('app.js', new TextEncoder().encode('small edit'));
  const edited = performance.now();
  const estimate = await navigator.storage.estimate();
  storage.close(); await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = resolve; r.onerror = reject; });
  return { initial100MBms: Math.round(initialized-start), smallWorkspaceEditMs: Math.round(edited-ready), loadAndVerify100MBms: Math.round(loaded-initialized), constructWorkspace100MBms: Math.round(ready-loaded), estimate };
});
console.log(JSON.stringify(result));
await browser.close();
