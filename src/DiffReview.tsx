import { useEffect, useRef, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';

monaco.editor.defineTheme('studio-diff', {
  base: 'vs-dark', inherit: true, rules: [], colors: {
    'editor.background': '#1b2026',
    'editor.lineHighlightBackground': '#ffffff0b',
    'editorLineNumber.activeForeground': '#e7efdf',
    'diffEditor.insertedLineBackground': '#20573f77',
    'diffEditor.removedLineBackground': '#6b303477',
    'diffEditor.insertedTextBackground': '#3a9c62aa',
    'diffEditor.removedTextBackground': '#bd585caa',
    'diffEditorGutter.insertedLineBackground': '#4db579',
    'diffEditorGutter.removedLineBackground': '#d97376',
  },
});

type Props = {
  locked?: boolean;
  path: string;
  paths: string[];
  original: string;
  modified: string;
  language: string;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onDiscard: () => void;
  onAccept: () => void;
};

export function DiffReview({ locked = false, path, paths, original, modified, language, onPathChange, onClose, onDiscard, onAccept }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<monaco.editor.IDiffEditorModel | null>(null);
  const subscriptionRef = useRef<monaco.IDisposable | null>(null);
  const focusedRef = useRef(false);
  const [changes, setChanges] = useState<monaco.editor.ILineChange[]>([]);
  const [active, setActive] = useState(0);
  const [split, setSplit] = useState(false);

  useEffect(() => () => {
    subscriptionRef.current?.dispose();
    // Detach before disposing: the React wrapper otherwise destroys models
    // while Monaco's diff widget still observes them.
    editorRef.current?.setModel(null);
    modelsRef.current?.original.dispose();
    modelsRef.current?.modified.dispose();
    editorRef.current = null;
    modelsRef.current = null;
  }, []);

  function focusChange(index: number, lines = changes, editor = editorRef.current) {
    if (!editor || !lines.length) return;
    const change = lines[index];
    const line = Math.max(1, change.modifiedStartLineNumber);
    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.setPosition({ lineNumber: line, column: 1 });
    modifiedEditor.revealLineInCenter(line);
    modifiedEditor.focus();
    setActive(index);
  }

  function onMount(editor: monaco.editor.IStandaloneDiffEditor) {
    editorRef.current = editor;
    modelsRef.current = editor.getModel();
    const refresh = () => {
      const next = editor.getLineChanges();
      if (!next) return;
      setChanges(next);
      if (next.length && !focusedRef.current) {
        focusedRef.current = true;
        editor.revealFirstDiff();
        focusChange(0, next, editor);
      }
    };
    subscriptionRef.current = editor.onDidUpdateDiff(refresh);
    refresh();
  }

  return <div className="diff-backdrop" role="presentation">
    <div className="diff-modal" role="dialog" aria-modal="true" aria-label={`Review changes to ${path}`}>
      <div className="diff-head"><div><span className="section-kicker">REVIEW AGENT CHANGES</span><h2>{path}</h2></div><div><select aria-label="Changed file" value={path} onChange={event => onPathChange(event.target.value)}>{paths.map(item => <option key={item} value={item}>{item}</option>)}</select><button onClick={onClose} aria-label="Close review"><X size={19} /></button></div></div>
      <div className="diff-toolbar">
        <div className="diff-legend"><span className="diff-added">+ Added</span><span className="diff-removed">− Removed</span><span className="diff-count">{changes.length ? `Change ${active + 1} of ${changes.length}` : 'No line changes'}</span></div>
        <div className="diff-controls"><div className="diff-mode" aria-label="Diff layout"><button className={!split ? 'selected' : ''} aria-pressed={!split} onClick={() => setSplit(false)}>Inline</button><button className={split ? 'selected' : ''} aria-pressed={split} onClick={() => setSplit(true)}>Split</button></div><button disabled={!changes.length} onClick={() => focusChange((active - 1 + changes.length) % changes.length)} title="Previous change" aria-label="Previous change"><ChevronUp size={15} /></button><button disabled={!changes.length} onClick={() => focusChange((active + 1) % changes.length)} title="Next change" aria-label="Next change"><ChevronDown size={15} /></button></div>
      </div>
      <div className="diff-editor"><DiffEditor original={original} modified={modified} language={language} theme="studio-diff" onMount={onMount} keepCurrentOriginalModel keepCurrentModifiedModel options={{ readOnly: true, originalEditable: false, minimap: { enabled: false }, fontSize: 12, lineHeight: 21, renderSideBySide: split, automaticLayout: true, scrollBeyondLastLine: false, renderIndicators: true, ignoreTrimWhitespace: false, hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 12, revealLineCount: 6 } }} /></div>
      <div className="diff-footer"><button disabled={locked} onClick={onDiscard}>Discard changes</button><button className="primary-small" disabled={locked} onClick={onAccept}><Check size={15} /> Accept {paths.length} {paths.length === 1 ? 'file' : 'files'}</button></div>
    </div>
  </div>;
}
