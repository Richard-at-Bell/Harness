import { memo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { iconFor, language } from './filePresentation';
import { useStudio, useWorkspace } from './studioContext';
import { toText } from './workspace';

export const FileEditor = memo(function FileEditor({ path }: { path: string }) {
  const studio = useStudio();
  const bytes = useWorkspace(state => state.files.get(path));
  // Keep the immediate typing value local; the store contains accepted bytes.
  const [draft, setDraft] = useState<{ path: string; base: Uint8Array | undefined; text: string } | null>(null);
  const [saving, setSaving] = useState(0);
  const text = draft?.path === path && (saving > 0 || draft.base === bytes) ? draft.text : bytes ? toText(bytes) : '';
  function save(content: string) {
    setDraft({ path, base: bytes, text: content }); setSaving(count => count + 1);
    studio.saveFile(path, content).catch(studio.report).finally(() => setSaving(count => count - 1));
  }
  return <section className="editor-pane"><div className="pane-label"><span className="pane-icon">{iconFor(path)}</span>{path}<span className="pane-meta">{path.endsWith('.xlsx') ? 'BINARY' : language(path).toUpperCase()}</span></div>{path.endsWith('.xlsx') ? <div className="binary-note">This spreadsheet is edited in the Data tab.</div> : <Editor path={path} language={language(path)} value={text} theme="vs-dark" onChange={value => save(value ?? '')} options={{ minimap: { enabled: false }, fontSize: 12, fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace', lineHeight: 21, padding: { top: 20 }, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, renderLineHighlight: 'line', overviewRulerBorder: false }} />}</section>;
});
