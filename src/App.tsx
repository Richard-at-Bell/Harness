import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronDown, Code2, FilePlus2, FileSpreadsheet, FolderOpen, KeyRound, LayoutPanelLeft, Play, Plus, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react';
import { AgentPane } from './AgentPane';
import { DataList } from './DataList';
import { DataPanel } from './DataPanel';
import { FileEditor } from './FileEditor';
import { FileList } from './FileList';
import { PreviewPanel } from './PreviewPanel';
import { useGeneration, useLifecycle, useSession, useStudio, useWorkspace } from './studioContext';

function Notice() {
  const studio = useStudio(), notice = useSession(state => state.notice);
  return notice ? <div className="toast"><span>{notice}</span><button onClick={() => studio.session.notice('')}><X size={14} /></button></div> : null;
}

function Breadcrumb({ tab, selected, tableId }: { tab: 'files' | 'data'; selected: string; tableId: string }) {
  const bytes = useWorkspace(state => tab === 'files' ? state.files.get(selected) : undefined);
  return <div className="file-breadcrumb"><span className="crumb-dim">{tab === 'data' ? 'studio' : 'project'}</span><span>/</span><strong>{tab === 'data' ? `fixtures / ${tableId}` : selected}</strong>{bytes && <span className="file-size">{(bytes.byteLength / 1024).toFixed(1)} KB</span>}</div>;
}

export function App() {
  const studio = useStudio();
  const generation = useGeneration();
  const importRef = useRef<HTMLInputElement>(null);
  const tableImportRef = useRef<HTMLInputElement>(null);
  const selection = useLifecycle(state => state.selection);
  const phase = useLifecycle(state => state.phase);
  const { file: selected, tab, tableId: selectedTableId } = selection;
  const setSelected = (file: string) => studio.select({ file });
  const setTab = (tab: 'files' | 'data') => studio.select({ tab });
  const setSelectedTableId = (tableId: string) => studio.select({ tableId });
  const [view, setView] = useState<'split' | 'code' | 'preview'>(() => window.innerWidth <= 1200 ? 'preview' : 'split');
  const [previewVersion, setPreviewVersion] = useState(0);
  const [key, setKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newItem, setNewItem] = useState<'file' | 'table' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 750);
  const [exportUrl, setExportUrl] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const exportLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);
  const closeAgent = useCallback(() => setRightOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openTableImport = useCallback(() => tableImportRef.current?.click(), []);

  async function importProject(file: File) {
    try { await studio.importProject(file); } catch (error) { studio.report(error); }
  }
  async function exportProject() {
    if (exportLock.current) return;
    exportLock.current = true; setExportBusy(true);
    try { const blob = await studio.exportProject(); if (mounted.current) setExportUrl(URL.createObjectURL(blob)); }
    catch (error) { studio.report(error); }
    finally { exportLock.current = false; if (mounted.current) setExportBusy(false); }
  }
  async function resetProject() {
    if (!window.confirm('Replace this project, its studio fixtures, and chats with a fresh to-do template? Export first if you want to keep your work.')) return;
    try { await studio.resetProject(); } catch (error) { studio.report(error); }
  }
  async function createNewItem() {
    const name = newItemName.trim();
    const captured = studio.generation;
    try {
      if (newItem === 'file') { await studio.createFile(name); if (studio.generation !== captured) return; setSelected(name); setTab('files'); setView('code'); }
      else if (newItem === 'table') { const id = name.toLowerCase(); await studio.createTable(id); if (studio.generation !== captured) return; setSelectedTableId(id); setTab('data'); }
      setNewItem(null); setNewItemName('');
    } catch (error) { studio.report(error); }
  }
  async function importTable(file: File) {
    const captured = studio.generation;
    try { const id = await studio.importTable(file); if (studio.generation !== captured) return; setSelectedTableId(id); setTab('data'); } catch (error) { studio.report(error); }
  }

  return <div className="studio">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><LayoutPanelLeft size={18} strokeWidth={2.4} /></div><span>Workbench</span><span className="brand-beta">BETA</span></div>
      <div className="topbar-center"><span className="project-dot" /> To-do project <ChevronDown size={14} /><span className="save-state" role="status">{phase === 'preparing' ? 'Preparing replacement…' : phase === 'committing' ? 'Replacing workspace…' : 'Browser workspace'}</span></div>
      <div className="topbar-actions">
        <button className="text-button" onClick={() => importRef.current?.click()} title="Import ZIP"><FolderOpen size={16} /> Import</button>
        <button className="text-button" onClick={exportProject} disabled={exportBusy} title="Export project, fixtures, and chats"><ArrowDownToLine size={16} /> {exportBusy ? 'Preparing ZIP…' : 'Export ZIP'}</button>
        {!rightOpen && <button className="top-icon mobile-agent-button" onClick={() => setRightOpen(true)} title="Open agent"><Sparkles size={17} /></button>}
        <button className="top-icon" onClick={() => setSettingsOpen(true)} title="API key settings"><KeyRound size={17} /></button>
        <input ref={importRef} type="file" accept=".zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) importProject(file); event.target.value = ''; }} />
        <input ref={tableImportRef} type="file" accept=".csv,.xlsx" hidden onChange={event => { const file = event.target.files?.[0]; if (file) importTable(file); event.target.value = ''; }} />
      </div>
    </header>

    <div className="work-area">
      <aside className="left-rail">
        <div className="rail-tabs"><button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}><Code2 size={16} /> Project</button><button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><FileSpreadsheet size={16} /> Studio data</button></div>
        <div className="rail-heading"><span>{tab === 'files' ? 'PROJECT FILES' : 'STUDIO FIXTURES'}</span><button onClick={() => { setNewItem(tab === 'files' ? 'file' : 'table'); setNewItemName(''); }} title={tab === 'files' ? 'New file' : 'New fixture'}><FilePlus2 size={15} /></button></div>
        {tab === 'files' ? <FileList selected={selected} onSelect={path => { setSelected(path); setView('code'); }} /> : <DataList selected={selectedTableId} onSelect={setSelectedTableId} onImport={openTableImport} />}
        <div className="rail-bottom"><button onClick={resetProject}><RotateCcw size={15} /> Reset template</button><span>Browser workspace · v0.1</span></div>
      </aside>

      <main className="main-pane">
        <div className="main-toolbar">
          <Breadcrumb tab={tab} selected={selected} tableId={selectedTableId} />
          <div className="view-switch">{tab === 'files' && <><button className={view === 'code' ? 'selected' : ''} onClick={() => setView('code')} title="Code"><Code2 size={15} /></button><button className={view === 'split' ? 'selected' : ''} onClick={() => setView('split')} title="Split"><LayoutPanelLeft size={15} /></button><button className={view === 'preview' ? 'selected' : ''} onClick={() => setView('preview')} title="Preview"><Play size={15} /></button></>}<button onClick={() => setPreviewVersion(v => v + 1)} title="Reload preview"><RefreshCw size={15} /></button></div>
        </div>

        <div className={`workspace-split ${view}`} style={{ display: tab === 'files' ? undefined : 'none' }}>
          <FileEditor key={generation} path={selected} visible={tab === 'files' && view !== 'preview'} />
          {tab === 'files' && view !== 'code' && <PreviewPanel reload={previewVersion} />}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} hidden={tab !== 'data'}><DataPanel key={generation} selectedTableId={selectedTableId} onImport={openTableImport} /></div>
      </main>

      <AgentPane open={rightOpen} onClose={closeAgent} apiKey={key} onNeedsKey={openSettings} />
      {!rightOpen && <button className="agent-reopen" onClick={() => setRightOpen(true)}><Sparkles size={17} /> Agent</button>}
    </div>

    {exportUrl && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setExportUrl(''); }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Export ready">
        <div className="modal-head"><div><span className="section-kicker">PROJECT EXPORT</span><h2>Your ZIP is ready</h2></div><button onClick={() => setExportUrl('')} aria-label="Close export"><X size={20} /></button></div>
        <p>Includes project files, Studio fixtures, all chats, and tool activity.</p>
        <div className="modal-actions"><button onClick={() => setExportUrl('')}>Close</button><a className="primary-small export-download" href={exportUrl} download="project-studio-export.zip"><ArrowDownToLine size={15} /> Download ZIP</a></div>
      </div>
    </div>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="API key settings">
        <div className="modal-head"><div><span className="section-kicker">MODEL CONNECTION</span><h2>OpenRouter key</h2></div><button onClick={() => setSettingsOpen(false)} aria-label="Close key settings"><X size={20} /></button></div>
        <p>Use your own OpenRouter key to run the agent.</p>
        <label>API key<input type="password" value={key} placeholder="sk-or-v1-…" onChange={event => setKey(event.target.value)} autoComplete="off" /></label>
        <p>The key stays in this tab and is excluded from the project and ZIP.</p>
        <div className="modal-actions"><button className="primary-small" onClick={() => setSettingsOpen(false)}><Check size={15} /> Done</button></div>
      </div>
    </div>}

    {newItem && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewItem(null); }}><div className="settings-modal"><div className="modal-head"><div><span className="section-kicker">{newItem === 'file' ? 'PROJECT WORKSPACE' : 'STUDIO DATA'}</span><h2>New {newItem === 'file' ? 'file' : 'fixture'}</h2></div><button onClick={() => setNewItem(null)} title="Close"><X size={20} /></button></div><p>{newItem === 'file' ? 'Enter a project-relative path, such as about.html.' : 'Enter a table name. A CSV with id and name columns will be created.'}</p><label>{newItem === 'file' ? 'File path' : 'Table name'}<input autoFocus value={newItemName} onChange={event => setNewItemName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') createNewItem(); }} placeholder={newItem === 'file' ? 'about.html' : 'products'} /></label><div className="modal-actions"><button onClick={() => setNewItem(null)}>Cancel</button><button className="primary-small" onClick={createNewItem}><Plus size={15} /> Create</button></div></div></div>}

    <Notice />
  </div>;
}
