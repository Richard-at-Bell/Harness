import { memo, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useStore } from 'zustand';
import { EditorDocuments } from './editorDocuments';
import { iconFor, language } from './filePresentation';
import { useGeneration, useStudio, useWorkspace } from './studioContext';
import { toText } from './workspace';

export const FileEditor = memo(function FileEditor({ path, visible }: { path: string; visible: boolean }) {
  const studio = useStudio();
  const generation = useGeneration();
  const bytes = useWorkspace(state => state.files.get(path));
  const [documents] = useState(() => new EditorDocuments((path, text) => studio.saveFile(path, text, generation), studio.report));
  const [activated, setActivated] = useState(visible);
  const draft = useStore(documents.store, state => state.drafts.get(path));
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const subscription = useRef<monaco.IDisposable | null>(null);
  const text = draft ? draft.text : bytes ? toText(bytes) : '';
  useEffect(() => { if (visible) setActivated(true); }, [visible]);

  useEffect(() => {
    documents.start();
    return () => {
      subscription.current?.dispose();
      // Detach the view before disposing its session-owned models.
      editor.current?.setModel(null);
      documents.stop();
    };
  }, [documents]);

  function onMount(instance: monaco.editor.IStandaloneCodeEditor) {
    subscription.current?.dispose();
    editor.current = instance;
    const retain = () => documents.retainModel(instance.getModel());
    retain();
    subscription.current = instance.onDidChangeModel(retain);
  }
  return <section className="editor-pane" style={{ display: visible ? undefined : 'none' }}>
    <div className="pane-label">
      <span className="pane-icon">{iconFor(path)}</span>{path}
      {draft?.status === 'saving' && <span role="status">Saving…</span>}
      {draft?.status === 'error' && <button onClick={() => void documents.retry(path)} title={draft.error}>Unsaved · Retry</button>}
      <span className="pane-meta">{path.endsWith('.xlsx') ? 'BINARY' : language(path).toUpperCase()}</span>
    </div>
    {path.endsWith('.xlsx') ? <div className="binary-note">This spreadsheet is edited in the Data tab.</div> : (activated || visible) && <Editor path={documents.modelPath(path)} keepCurrentModel onMount={onMount} language={language(path)} value={text} theme="vs-dark" onChange={value => void documents.edit(path, value ?? '')} options={{ minimap: { enabled: false }, fontSize: 12, fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace', lineHeight: 21, padding: { top: 20 }, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, renderLineHighlight: 'line', overviewRulerBorder: false }} />}
  </section>;
});
