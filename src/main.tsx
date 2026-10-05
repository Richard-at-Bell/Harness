import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './configureMonaco';
import { App } from './App';
import { StudioContext } from './studioContext';
import { StudioRuntime } from './studioRuntime';
import './styles.css';

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
