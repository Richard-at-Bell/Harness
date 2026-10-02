import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { App } from './App';
import { StudioContext } from './studioContext';
import { StudioRuntime } from './studioRuntime';
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

// Cache opening across React effect replays; attach persistence only after load.
let opening: Promise<StudioRuntime> | undefined;
function Studio() {
  const [runtime, setRuntime] = useState<StudioRuntime | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let loaded: StudioRuntime | undefined;
    opening ||= StudioRuntime.open();
    opening.then(studio => { if (active) { loaded = studio; studio.start(); setRuntime(studio); } }).catch(error => { if (active) setError(String(error instanceof Error ? error.message : error)); });
    return () => { active = false; loaded?.stop(); };
  }, []);
  return runtime ? <StudioContext.Provider value={runtime}><App /></StudioContext.Provider> : <div className="preview-loading">{error || 'Opening workspace…'}</div>;
}

const rootElement = document.getElementById('root')! as HTMLElement & { __studioRoot?: Root };
const root = rootElement.__studioRoot ||= createRoot(rootElement);
root.render(<Studio />);
