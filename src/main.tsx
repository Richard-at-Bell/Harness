import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, Code2, FileCode2, FilePlus2, FileSpreadsheet, FolderOpen, KeyRound, LayoutPanelLeft, MessageSquareText, PanelRightClose, Play, Plus, RefreshCw, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react';
import { runAgent } from './agent';
import { ActivityPanel } from './ActivityPanel';
import { ChatSwitcher } from './ChatSwitcher';
import { DiffReview } from './DiffReview';
import { loadLiveModels, MODEL_CHOICES, modelName, pricePerMillion, type LiveModel } from './models';
import { exportZip, importZip } from './export';
import { fixtureIds, generateRows, readTable, tableBytes, type Row, type Table } from './fixtures';
import { buildPreview, codeSignature } from './preview';
import { templateFiles, templateFixtures } from './template';
import { loadSession, newStudioChat, saveSession, Stage, titleForChat, toBytes, toText, validProjectPath, Workspace, type ChatLine, type FileMap, type StudioChat, type ToolLine } from './workspace';
import './styles.css';

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new jsonWorker();
    if (['css', 'scss', 'less'].includes(label)) return new cssWorker();
    if (['html', 'handlebars', 'razor'].includes(label)) return new htmlWorker();
    if (['typescript', 'javascript'].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

type View = 'split' | 'code' | 'preview';
type Tab = 'files' | 'data';

function language(path: string) {
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.csv')) return 'plaintext';
  return 'plaintext';
}

function iconFor(path: string) {
  return path.endsWith('.csv') || path.endsWith('.xlsx') ? <FileSpreadsheet size={15} /> : <FileCode2 size={15} />;
}

function App() {
  const workspaceRef = useRef<Workspace | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const tableImportRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridgeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const bottomRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef(crypto.randomUUID());
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<FileMap>(new Map());
  const [fixtures, setFixtures] = useState<FileMap>(new Map());
  const [selected, setSelected] = useState('app.js');
  const [tab, setTab] = useState<Tab>('files');
  const [view, setView] = useState<View>(() => window.innerWidth <= 1200 ? 'preview' : 'split');
  const [previewDoc, setPreviewDoc] = useState('');
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewBuildId, setPreviewBuildId] = useState(0);
  const initialChat = useRef<StudioChat>(newStudioChat());
  const [chats, setChats] = useState<StudioChat[]>([initialChat.current]);
  const [activeChatId, setActiveChatId] = useState(initialChat.current.id);
  const activeChat = chats.find(item => item.id === activeChatId) || chats[0];
  const chat = activeChat.chat;
  const tools = activeChat.tools;
  const history = activeChat.agentMessages;
  const [prompt, setPrompt] = useState('');
  const [key, setKey] = useState('');
  const modelId = activeChat.modelId;
  const [liveModels, setLiveModels] = useState<Map<string, LiveModel> | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newItem, setNewItem] = useState<'file' | 'table' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Stage | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffPath, setDiffPath] = useState('');
  const [diffTexts, setDiffTexts] = useState<{ stage: Stage | null; path: string; original: string; modified: string }>({ stage: null, path: '', original: '', modified: '' });
  const [table, setTable] = useState<Table | null>(null);
  const [selectedTableId, setSelectedTableId] = useState('todos');
  const [generationSeed, setGenerationSeed] = useState(42);
  const [generationCount, setGenerationCount] = useState(8);
  const [notice, setNotice] = useState('');
  const [exportUrl, setExportUrl] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 750);

  function updateActive(change: (current: StudioChat) => StudioChat) {
    setChats(current => current.map(item => item.id === activeChatId ? { ...change(item), updatedAt: new Date().toISOString() } : item));
  }
  function setChat(value: SetStateAction<ChatLine[]>) { updateActive(current => ({ ...current, chat: typeof value === 'function' ? value(current.chat) : value })); }
  function setTools(value: SetStateAction<ToolLine[]>) { updateActive(current => ({ ...current, tools: typeof value === 'function' ? value(current.tools) : value })); }
  function setHistory(value: SetStateAction<unknown[]>) { updateActive(current => ({ ...current, agentMessages: typeof value === 'function' ? value(current.agentMessages) : value })); }
  function setModelId(value: string) { updateActive(current => ({ ...current, modelId: value })); }

  useEffect(() => {
    let active = true;
    Promise.all([Workspace.open(), loadSession()]).then(([workspace, session]) => {
      if (!active) return;
      workspaceRef.current = workspace;
      setFiles(workspace.snapshot());
      setFixtures(workspace.fixtureSnapshot());
      setChats(session.chats);
      setActiveChatId(session.activeChatId);
      setReady(true);
    }).catch(error => setNotice(String(error.message || error)));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => { saveSession({ version: 2, chats, activeChatId }).catch(console.error); }, 350);
    return () => window.clearTimeout(timer);
  }, [ready, chats, activeChatId]);

  const signature = useMemo(() => codeSignature(files), [files]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    buildPreview(files, fixtures, tokenRef.current).then(doc => { if (active) { setPreviewDoc(doc); setPreviewBuildId(id => id + 1); } }).catch(error => setNotice(String(error.message || error)));
    return () => { active = false; };
  }, [ready, signature, previewVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    let active = true;
    readTable(fixtures, selectedTableId).then(value => { if (active) setTable(value); }).catch(() => { if (active) setTable(null); });
    return () => { active = false; };
  }, [ready, fixtures, selectedTableId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat, busy]);

  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);

  useEffect(() => {
    if (!settingsOpen || liveModels) return;
    const controller = new AbortController();
    loadLiveModels(controller.signal).then(models => { setLiveModels(models); setCatalogError(''); }).catch(error => {
      if (!controller.signal.aborted) setCatalogError(String(error instanceof Error ? error.message : error));
    });
    return () => controller.abort();
  }, [settingsOpen, liveModels]);

  useEffect(() => {
    if (!pending || !diffPath) return;
    let active = true;
    async function render(bytes: Uint8Array | undefined) {
      if (!bytes) return '';
      if (!diffPath.endsWith('.xlsx')) return toText(bytes);
      const id = /^fixtures\/([^/]+)\.xlsx$/.exec(diffPath)?.[1];
      if (!id) return 'Binary spreadsheet file';
      try {
        const value = await readTable(new Map([[diffPath, bytes!]]), id);
        return JSON.stringify({ columns: value.columns, rows: value.rows }, null, 2);
      } catch { return 'Unable to display spreadsheet contents'; }
    }
    Promise.all([render(pending.readBaseline(diffPath)), render(pending.readCurrent(diffPath))]).then(([original, modified]) => { if (active) setDiffTexts({ stage: pending, path: diffPath, original, modified }); });
    return () => { active = false; };
  }, [pending, diffPath]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.data?.token !== tokenRef.current) return;
      const message = event.data;
      if (message.kind === 'preview.error') { setNotice(`Preview: ${message.message}`); return; }
      if (message.kind !== 'table.request') return;
      const reply = (ok: boolean, value?: unknown, error?: string) => frameRef.current?.contentWindow?.postMessage({ token: tokenRef.current, id: message.id, ok, value, error }, '*');
      const task = async () => {
      try {
        if (!['list', 'insert', 'update', 'remove'].includes(message.op) || !/^[a-z0-9_-]{1,60}$/i.test(message.table)) throw new Error('Invalid table request');
        if (JSON.stringify(message.payload ?? '').length > 200_000) throw new Error('Table request is too large');
        const workspace = workspaceRef.current!;
        const current = await readTable(workspace.fixtures, message.table);
        if (message.op === 'list') { reply(true, current.rows); return; }
        if (current.rows.length >= 10_000 && message.op === 'insert') throw new Error('Table is full');
        let value: Row | undefined;
        if (message.op === 'insert') {
          if (!message.payload || typeof message.payload !== 'object') throw new Error('Invalid row');
          value = { ...message.payload, id: message.payload.id || crypto.randomUUID() };
          current.rows.push(value!);
        } else {
          const index = current.rows.findIndex(row => String(row.id) === String(message.payload?.id));
          if (index < 0) throw new Error('Row not found');
          if (message.op === 'update') { current.rows[index] = { ...current.rows[index], ...message.payload.patch }; value = current.rows[index]; }
          if (message.op === 'remove') value = current.rows.splice(index, 1)[0];
        }
        await workspace.writeFixture(current.path, await tableBytes(current));
        setFixtures(workspace.fixtureSnapshot());
        reply(true, value);
        frameRef.current?.contentWindow?.postMessage({ kind: 'table.changed', table: message.table, token: tokenRef.current }, '*');
      } catch (error) { const message = String(error instanceof Error ? error.message : error); reply(false, undefined, message); setNotice(`Table write failed: ${message}`); }
      };
      bridgeQueueRef.current = bridgeQueueRef.current.then(task, task);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 4200); };
  const notifyTable = (path: string) => {
    const id = /^fixtures\/([^/]+)\.(csv|xlsx)$/.exec(path)?.[1];
    if (id) frameRef.current?.contentWindow?.postMessage({ kind: 'table.changed', table: id, token: tokenRef.current }, '*');
  };
  const chooseModel = (id: string) => {
    if (id === modelId) return;
    setModelId(id);
    setHistory([]);
  };
  const switchChat = (id: string) => {
    if (busy || pending || id === activeChatId) return;
    setActiveChatId(id);
    setPrompt('');
  };
  const createChat = () => {
    if (busy || pending) return;
    const next = { ...newStudioChat(modelId), title: `New chat ${chats.length + 1}` };
    setChats(current => [...current, next]);
    setActiveChatId(next.id);
    setPrompt('');
  };
  const renameChat = (id: string, title: string) => {
    if (!title || busy || pending) return;
    setChats(current => current.map(item => item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item));
  };

  async function saveFile(path: string, content: string) {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    setFiles(new Map(files).set(path, toBytes(content)));
    try { await workspace.write(path, toBytes(content)); setFiles(workspace.snapshot()); notifyTable(path); }
    catch (error) { flash(String(error)); }
  }

  async function sendPrompt() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!key.trim()) { setSettingsOpen(true); return; }
    if (pending) { flash('Review the pending change before starting another agent turn.'); return; }
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const stage = workspace.stage();
    const answerId = crypto.randomUUID();
    setPrompt(''); setBusy(true);
    if (!chat.length && /^New chat(?: \d+)?$/.test(activeChat.title)) updateActive(current => ({ ...current, title: titleForChat(text) }));
    setChat(current => [...current, { id: crypto.randomUUID(), role: 'user', text, time: new Date().toISOString() }, { id: answerId, role: 'assistant', text: '', time: new Date().toISOString(), model: modelId }]);
    try {
      const outcome = await runAgent(text, key.trim(), modelId.trim(), stage, history, {
        onText: value => setChat(current => current.map(line => line.id === answerId ? { ...line, text: value } : line)),
        onTool: line => setTools(current => [...current.filter(item => item.id !== line.id), line]),
      });
      setChat(current => current.map(line => line.id === answerId ? { ...line, text: outcome.text || 'Done.' } : line));
      setHistory(outcome.messages);
      if (stage.changes().length) { setPending(stage); setDiffPath(stage.changes()[0]); setDiffOpen(true); }
    } catch (error) {
      setChat(current => current.map(line => line.id === answerId ? { ...line, text: `Agent error: ${String(error instanceof Error ? error.message : error)}` } : line));
      if (stage.changes().length) { setPending(stage); setDiffPath(stage.changes()[0]); setDiffOpen(true); }
    } finally { setBusy(false); }
  }

  async function acceptStage() {
    const workspace = workspaceRef.current;
    if (!workspace || !pending) return;
    if (workspace.revision !== pending.baseRevision) { flash('The project changed during this turn. Revert the staged change and ask the agent to retry.'); return; }
    await workspace.replace(pending.files, pending.fixtures);
    for (const path of pending.changes()) notifyTable(path);
    setFiles(workspace.snapshot()); setFixtures(workspace.fixtureSnapshot()); setPending(null); setDiffOpen(false); flash('Agent changes accepted.');
  }

  function rejectStage() { setPending(null); setDiffOpen(false); flash('Agent changes discarded.'); }

  async function importProject(file: File) {
    try {
      const imported = await importZip(file);
      await workspaceRef.current!.replace(imported.files, imported.fixtures);
      setFiles(workspaceRef.current!.snapshot()); setFixtures(workspaceRef.current!.fixtureSnapshot()); setSelected('index.html'); setSelectedTableId(fixtureIds(imported.fixtures)[0] || 'todos'); setChats(imported.chats); setActiveChatId(imported.activeChatId); setPending(null); setTab('files');
      flash('Project imported.');
    } catch (error) { flash(String(error instanceof Error ? error.message : error)); }
  }

  async function exportProject() {
    if (!workspaceRef.current || exportBusy) return;
    setExportBusy(true);
    try { setExportUrl(URL.createObjectURL(await exportZip(workspaceRef.current.files, workspaceRef.current.fixtures, chats, activeChatId))); }
    catch (error) { flash(String(error instanceof Error ? error.message : error)); }
    finally { setExportBusy(false); }
  }

  async function resetProject() {
    if (!window.confirm('Replace this project, its studio fixtures, and chats with a fresh to-do template? Export first if you want to keep your work.')) return;
    const next = new Map(Object.entries(templateFiles).map(([path, value]) => [path, toBytes(value)]));
    const nextFixtures = new Map(Object.entries(templateFixtures).map(([path, value]) => [path, toBytes(value)]));
    await workspaceRef.current!.replace(next, nextFixtures);
    const newChat = newStudioChat(modelId);
    setFiles(workspaceRef.current!.snapshot()); setFixtures(workspaceRef.current!.fixtureSnapshot()); setChats([newChat]); setActiveChatId(newChat.id); setPending(null); setSelected('app.js'); setSelectedTableId('todos'); flash('Fresh to-do project created.');
  }

  async function createNewItem() {
    const name = newItemName.trim();
    if (newItem === 'file') {
      if (!validProjectPath(name) || files.has(name)) { flash('Choose a valid new project path.'); return; }
      await workspaceRef.current!.write(name, toBytes(''));
      setFiles(workspaceRef.current!.snapshot()); setSelected(name); setTab('files'); setView('code');
    } else if (newItem === 'table') {
      const id = name.toLowerCase();
      if (!/^[a-z0-9_-]{1,60}$/.test(id) || fixtureIds(fixtures).includes(id)) { flash('Choose a new table name using letters, numbers, hyphens, or underscores.'); return; }
      const next: Table = { path: `fixtures/${id}.csv`, format: 'csv', columns: ['id', 'name'], rows: [] };
      await workspaceRef.current!.writeFixture(next.path, await tableBytes(next));
      setFixtures(workspaceRef.current!.fixtureSnapshot()); setSelectedTableId(id); setTab('data');
    }
    setNewItem(null); setNewItemName('');
  }

  async function saveTable() {
    if (!table) return;
    try { await workspaceRef.current!.writeFixture(table.path, await tableBytes(table)); setFixtures(workspaceRef.current!.fixtureSnapshot()); notifyTable(table.path); flash('Studio fixture saved.'); }
    catch (error) { flash(String(error)); }
  }

  async function importTable(file: File) {
    const match = /^([a-z0-9_-]{1,60})\.(csv|xlsx)$/i.exec(file.name);
    if (!match) { flash('Use a CSV or XLSX filename with letters, numbers, hyphens, or underscores.'); return; }
    const id = match[1].toLowerCase();
    const path = `fixtures/${id}.${match[2].toLowerCase()}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      if (bytes.byteLength > 20_000_000) throw new Error('Fixture is larger than 20 MB');
      await readTable(new Map([[path, bytes]]), id);
      const workspace = workspaceRef.current!;
      for (const existing of [`fixtures/${id}.csv`, `fixtures/${id}.xlsx`]) if (existing !== path && workspace.fixtures.has(existing)) await workspace.removeFixture(existing);
      await workspace.writeFixture(path, bytes);
      notifyTable(path);
      setFixtures(workspace.fixtureSnapshot()); setSelectedTableId(id); setTab('data');
      flash(`Imported ${id}.${match[2].toLowerCase()}.`);
    } catch (error) { flash(String(error instanceof Error ? error.message : error)); }
  }

  async function convertTable() {
    if (!table) return;
    try {
      const nextPath = table.path.replace(/\.(csv|xlsx)$/, table.format === 'csv' ? '.xlsx' : '.csv');
      const converted: Table = { ...table, path: nextPath, format: table.format === 'csv' ? 'xlsx' : 'csv' };
      const bytes = await tableBytes(converted);
      await workspaceRef.current!.removeFixture(table.path);
      await workspaceRef.current!.writeFixture(nextPath, bytes);
      notifyTable(nextPath);
      setFixtures(workspaceRef.current!.fixtureSnapshot()); flash(`Converted table to ${converted.format.toUpperCase()}.`);
    } catch (error) { flash(String(error)); }
  }

  const filePaths = [...files.keys()].sort((a, b) => a.localeCompare(b));
  const selectedBytes = files.get(selected);
  const selectedText = selectedBytes && !selected.endsWith('.xlsx') ? toText(selectedBytes) : '';
  const changed = pending?.changes() || [];
  const tableIds = fixtureIds(fixtures);

  return <div className="studio">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><LayoutPanelLeft size={18} strokeWidth={2.4} /></div><span>Workbench</span><span className="brand-beta">BETA</span></div>
      <div className="topbar-center"><span className="project-dot" /> To-do project <ChevronDown size={14} /><span className="save-state">{ready ? 'Saved locally' : 'Opening…'}</span></div>
      <div className="topbar-actions">
        <button className="text-button" onClick={() => importRef.current?.click()} title="Import ZIP"><FolderOpen size={16} /> Import</button>
        <button className="text-button" onClick={exportProject} disabled={!ready || exportBusy} title="Export project, fixtures, and chats"><ArrowDownToLine size={16} /> {exportBusy ? 'Preparing ZIP…' : 'Export ZIP'}</button>
        {!rightOpen && <button className="top-icon mobile-agent-button" onClick={() => setRightOpen(true)} title="Open agent"><Sparkles size={17} /></button>}
        <button className="top-icon" onClick={() => setSettingsOpen(true)} title="Model settings"><KeyRound size={17} /></button>
        <input ref={importRef} type="file" accept=".zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) importProject(file); event.target.value = ''; }} />
        <input ref={tableImportRef} type="file" accept=".csv,.xlsx" hidden onChange={event => { const file = event.target.files?.[0]; if (file) importTable(file); event.target.value = ''; }} />
      </div>
    </header>

    <div className="work-area">
      <aside className="left-rail">
        <div className="rail-tabs"><button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}><Code2 size={16} /> Project</button><button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><FileSpreadsheet size={16} /> Studio data</button></div>
        <div className="rail-heading"><span>{tab === 'files' ? 'PROJECT FILES' : 'STUDIO FIXTURES'}</span><button onClick={() => { setNewItem(tab === 'files' ? 'file' : 'table'); setNewItemName(''); }} title={tab === 'files' ? 'New file' : 'New fixture'}><FilePlus2 size={15} /></button></div>
        {tab === 'files' ? <div className="file-list">{filePaths.map(path => <button key={path} className={`file-item ${selected === path ? 'selected' : ''}`} onClick={() => { setSelected(path); setView('code'); }}>{iconFor(path)} <span>{path}</span></button>)}</div> : <div className="data-list">{tableIds.map(id => <button key={id} className={`data-item ${selectedTableId === id ? 'selected' : ''}`} onClick={() => setSelectedTableId(id)}><span className="data-icon"><FileSpreadsheet size={16} /></span><span><strong>{id}</strong><small>{id === selectedTableId && table ? `${table.rows.length} rows · ${table.format.toUpperCase()}` : (fixtures.has(`fixtures/${id}.xlsx`) ? 'XLSX' : 'CSV')}</small></span></button>)}<button className="import-fixture" onClick={() => tableImportRef.current?.click()}><Plus size={14} /> Import CSV / XLSX</button><p>Fixtures live in Studio and are included in the ZIP under studio/fixtures.</p></div>}
        <div className="rail-bottom"><button onClick={resetProject}><RotateCcw size={15} /> Reset template</button><span>Browser workspace · v0.1</span></div>
      </aside>

      <main className="main-pane">
        <div className="main-toolbar">
          <div className="file-breadcrumb"><span className="crumb-dim">{tab === 'data' ? 'studio' : 'project'}</span><span>/</span><strong>{tab === 'data' ? `fixtures / ${selectedTableId}` : selected}</strong>{tab === 'files' && selectedBytes && <span className="file-size">{(selectedBytes.byteLength / 1024).toFixed(1)} KB</span>}</div>
          <div className="view-switch">{tab === 'files' && <><button className={view === 'code' ? 'selected' : ''} onClick={() => setView('code')} title="Code"><Code2 size={15} /></button><button className={view === 'split' ? 'selected' : ''} onClick={() => setView('split')} title="Split"><LayoutPanelLeft size={15} /></button><button className={view === 'preview' ? 'selected' : ''} onClick={() => setView('preview')} title="Preview"><Play size={15} /></button></>}<button onClick={() => setPreviewVersion(v => v + 1)} title="Reload preview"><RefreshCw size={15} /></button></div>
        </div>

        {tab === 'files' ? <div className={`workspace-split ${view}`}>
          {view !== 'preview' && <section className="editor-pane"><div className="pane-label"><span className="pane-icon">{iconFor(selected)}</span>{selected}<span className="pane-meta">{selected.endsWith('.xlsx') ? 'BINARY' : language(selected).toUpperCase()}</span></div>{selected.endsWith('.xlsx') ? <div className="binary-note">This spreadsheet is edited in the Data tab.</div> : <Editor path={selected} language={language(selected)} value={selectedText} theme="vs-dark" onChange={value => saveFile(selected, value ?? '')} options={{ minimap: { enabled: false }, fontSize: 12, fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace', lineHeight: 21, padding: { top: 20 }, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, renderLineHighlight: 'line', overviewRulerBorder: false }} />}</section>}
          {view !== 'code' && <section className="preview-pane"><div className="pane-label"><span className="preview-live"><span /> LIVE PREVIEW</span><span className="preview-address">index.html</span><button onClick={() => setPreviewVersion(v => v + 1)} title="Reload preview"><RefreshCw size={14} /></button></div><div className="preview-canvas">{previewDoc ? <iframe ref={frameRef} key={previewBuildId} title="Project preview" sandbox="allow-scripts allow-forms" srcDoc={previewDoc} /> : <span className="preview-loading">Preparing preview…</span>}</div></section>}
        </div> : <section className="table-pane"><div className="table-top"><div><span className="section-kicker">STUDIO FIXTURE</span><h2>{selectedTableId} <span>{table?.rows.length || 0} rows</span></h2><p>Changes are saved to Studio data and reflected in the preview.</p></div><div className="table-actions"><button onClick={() => tableImportRef.current?.click()}>Import CSV / XLSX</button><button onClick={convertTable} disabled={!table}>Convert to {table?.format === 'csv' ? 'XLSX' : 'CSV'}</button><button className="primary-small" onClick={saveTable} disabled={!table}><Check size={14} /> Save table</button></div></div>{table ? <><div className="fixture-generator"><span>Generate rows</span><label>Seed <input type="number" value={generationSeed} onChange={event => setGenerationSeed(Number(event.target.value))} /></label><label>Count <input type="number" min="1" max="100" value={generationCount} onChange={event => setGenerationCount(Number(event.target.value))} /></label><button onClick={() => setTable(current => current && ({ ...current, rows: generateRows(current, generationSeed, generationCount) }))}>Generate</button><small>Preview first, then save.</small></div><div className="table-scroll"><table><thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}<th /></tr></thead><tbody>{table.rows.map((row, index) => <tr key={String(row.id || index)}>{table.columns.map(column => <td key={column}>{column === 'completed' ? <input type="checkbox" checked={Boolean(row[column])} onChange={event => setTable(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, [column]: event.target.checked } : item) }))} /> : <input value={String(row[column] ?? '')} onChange={event => setTable(current => current && ({ ...current, rows: current.rows.map((item, i) => i === index ? { ...item, [column]: event.target.value } : item) }))} />}</td>)}<td><button className="row-delete" onClick={() => setTable(current => current && ({ ...current, rows: current.rows.filter((_, i) => i !== index) }))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div><button className="add-row" onClick={() => setTable(current => current && ({ ...current, rows: [...current.rows, Object.fromEntries(current.columns.map(column => [column, column === 'id' ? crypto.randomUUID() : column === 'completed' ? false : column === 'created_at' ? new Date().toISOString() : '']))] }))}><Plus size={15} /> Add row</button></> : <div className="table-empty">No `{selectedTableId}` studio fixture.</div>}</section>}
      </main>

      {rightOpen ? <aside className="agent-pane"><div className="agent-header"><div className="agent-header-top"><div><div className="agent-title"><Sparkles size={16} /> Agent</div><span>Build with your workspace</span></div><button onClick={() => setRightOpen(false)} title="Hide agent"><PanelRightClose size={18} /></button></div><ChatSwitcher chats={chats} activeId={activeChatId} locked={busy || Boolean(pending)} onSelect={switchChat} onNew={createChat} onRename={renameChat} /></div>
        <div className="agent-scroll">
          {!chat.length && <div className="empty-chat"><div className="empty-chat-icon"><MessageSquareText size={21} /></div><h2>What should we make?</h2><p>Ask the agent to shape your project. Every file change is yours to review.</p><div className="suggestions"><button onClick={() => setPrompt('Add a priority field to tasks and show high-priority tasks first.')}>Add task priorities <ArrowRight size={14} /></button><button onClick={() => setPrompt('Make the to-do app work well on small screens.')}>Improve mobile layout <ArrowRight size={14} /></button><button onClick={() => setPrompt('Add a filter for all, open, and completed tasks.')}>Add task filters <ArrowRight size={14} /></button></div></div>}
          {chat.map(line => <div key={line.id} className={`chat-line ${line.role}`}><div className="chat-avatar">{line.role === 'user' ? 'You' : <Sparkles size={14} />}</div><div className="chat-body"><span className="chat-role">{line.role === 'user' ? 'You' : line.model ? modelName(line.model) : 'Agent'}</span><div className="chat-text">{line.text || (busy ? <span className="typing">Thinking<span>…</span></span> : '')}</div></div></div>)}
          <ActivityPanel tools={tools} />
          {pending && <div className="pending-card"><div className="pending-top"><span><span className="pending-dot" /> REVIEW CHANGES</span><strong>{changed.length} {changed.length === 1 ? 'file' : 'files'}</strong></div><div className="pending-files">{changed.map(path => <button key={path} onClick={() => { setDiffPath(path); setDiffOpen(true); }}>{iconFor(path)} {path} <ArrowRight size={13} /></button>)}</div><div className="pending-actions"><button onClick={rejectStage}>Discard</button><button className="accept" onClick={acceptStage}><Check size={14} /> Accept changes</button></div></div>}
          <div ref={bottomRef} />
        </div>
        <div className="composer"><div className="composer-box"><textarea placeholder="Ask the agent to edit your project…" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendPrompt(); } }} rows={3} /><div className="composer-bottom"><button className="model-button" onClick={() => setSettingsOpen(true)}><span className={key ? 'model-dot ready' : 'model-dot'} /> {modelName(modelId)} <ChevronDown size={13} /></button><button className="send-button" disabled={!prompt.trim() || busy} onClick={sendPrompt} title="Send"><Send size={16} /></button></div></div><p>{key ? 'Agent changes are staged for your review.' : 'Add an OpenRouter key in model settings to start.'}</p></div>
      </aside> : <button className="agent-reopen" onClick={() => setRightOpen(true)}><Sparkles size={17} /> Agent</button>}
    </div>

    {exportUrl && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setExportUrl(''); }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Export ready">
        <div className="modal-head"><div><span className="section-kicker">PROJECT EXPORT</span><h2>Your ZIP is ready</h2></div><button onClick={() => setExportUrl('')} aria-label="Close export"><X size={20} /></button></div>
        <p>Includes project files, Studio fixtures, all chats, and tool activity.</p>
        <div className="modal-actions"><button onClick={() => setExportUrl('')}>Close</button><a className="primary-small export-download" href={exportUrl} download="project-studio-export.zip"><ArrowDownToLine size={15} /> Download ZIP</a></div>
      </div>
    </div>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <div className="settings-modal model-modal">
        <div className="modal-head"><div><span className="section-kicker">MODEL CONNECTION</span><h2>Choose an agent model</h2></div><button onClick={() => setSettingsOpen(false)} title="Close"><X size={20} /></button></div>
        <p>Choose a tool-capable OpenRouter model. Prices update from OpenRouter when available.</p>
        <div className="model-catalog-status">{liveModels ? 'Live availability and prices' : catalogError ? 'Live catalog unavailable; curated models remain selectable' : 'Checking live availability and prices…'}</div>
        <div className="model-options">{MODEL_CHOICES.map(choice => {
          const live = liveModels?.get(choice.id);
          const input = pricePerMillion(live?.pricing?.prompt);
          const output = pricePerMillion(live?.pricing?.completion);
          return <button key={choice.id} type="button" className={`model-option ${modelId === choice.id ? 'selected' : ''}`} disabled={Boolean(liveModels && !live)} onClick={() => chooseModel(choice.id)} aria-pressed={modelId === choice.id}>
            <span className="model-option-top"><strong>{choice.name}</strong><span className="model-badge">{choice.badge}</span></span>
            <span className="model-maker">{choice.maker} · {choice.id}</span>
            <span className="model-description">{choice.description}</span>
            <span className="model-price">{liveModels && !live ? 'Unavailable on OpenRouter' : input && output ? `${input} in / ${output} out per 1M tokens` : 'Pricing loads from OpenRouter'}</span>
          </button>;
        })}</div>
        <details className="model-custom"><summary>Use another model ID</summary><label>OpenRouter model ID<input value={modelId} onChange={event => chooseModel(event.target.value)} spellCheck={false} /></label></details>
        <label>API key<input type="password" value={key} placeholder="sk-or-v1-…" onChange={event => setKey(event.target.value)} autoComplete="off" /></label>
        <p className="model-footnote">The key stays in this tab. Changing models starts fresh agent context while keeping your project and visible chat.</p>
        <div className="modal-actions"><button className="primary-small" onClick={() => setSettingsOpen(false)}><Check size={15} /> Use {modelName(modelId)}</button></div>
      </div>
    </div>}

    {newItem && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewItem(null); }}><div className="settings-modal"><div className="modal-head"><div><span className="section-kicker">{newItem === 'file' ? 'PROJECT WORKSPACE' : 'STUDIO DATA'}</span><h2>New {newItem === 'file' ? 'file' : 'fixture'}</h2></div><button onClick={() => setNewItem(null)} title="Close"><X size={20} /></button></div><p>{newItem === 'file' ? 'Enter a project-relative path, such as about.html.' : 'Enter a table name. A CSV with id and name columns will be created.'}</p><label>{newItem === 'file' ? 'File path' : 'Table name'}<input autoFocus value={newItemName} onChange={event => setNewItemName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') createNewItem(); }} placeholder={newItem === 'file' ? 'about.html' : 'products'} /></label><div className="modal-actions"><button onClick={() => setNewItem(null)}>Cancel</button><button className="primary-small" onClick={createNewItem}><Plus size={15} /> Create</button></div></div></div>}

    {diffOpen && pending && diffTexts.stage === pending && diffTexts.path === diffPath && <DiffReview key={diffPath} path={diffPath} paths={changed} original={diffTexts.original} modified={diffTexts.modified} language={diffPath.endsWith('.xlsx') ? 'json' : language(diffPath)} onPathChange={setDiffPath} onClose={() => setDiffOpen(false)} onDiscard={rejectStage} onAccept={acceptStage} />}
    {notice && <div className="toast"><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}
  </div>;
}

const rootElement = document.getElementById('root')! as HTMLElement & { __studioRoot?: Root };
const root = rootElement.__studioRoot ||= createRoot(rootElement);
root.render(<App />);
