import { memo, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fixtureIds, metadataPath } from './fixtures';
import { toText } from './workspace';
import { buildPreview } from './preview';
import { useGeneration, useStudio, useWorkspace } from './studioContext';

export const PreviewPanel = memo(function PreviewPanel({ reload }: { reload: number }) {
  const studio = useStudio();
  const files = useWorkspace(state => state.files);
  const generation = useGeneration();
  const frame = useRef<HTMLIFrameElement>(null);
  const identity = useRef<{ token: string; generation: number } | null>(null);
  const [build, setBuild] = useState<{ doc: string; token: string; generation: number } | null>(null);
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    let active = true;
    identity.current = null;
    const token = crypto.randomUUID();
    // Fixture changes notify the live adapter. They are seeded only at a build.
    const fixtures = studio.workspace.fixtureSnapshot();
    buildPreview(files, fixtures, token).then(doc => {
      if (active) { identity.current = { token, generation }; setBuild({ doc, token, generation }); }
    }).catch(error => { if (active) studio.report(error); });
    return () => { active = false; identity.current = null; };
  }, [studio, files, generation, reload, localReload]);

  useEffect(() => {
    const send = (value: unknown) => {
      const current = identity.current;
      if (current) frame.current?.contentWindow?.postMessage({ ...value as object, token: current.token }, '*');
    };
    const unsubscribe = studio.workspace.store.subscribe((next, before) => {
      const tables = new Set<string>();
      const paths = new Set([...next.fixtures.keys(), ...before.fixtures.keys()]);
      for (const path of paths) if (next.fixtures.get(path) !== before.fixtures.get(path)) {
        const metaPath = path.endsWith('.dataset.json') ? path : metadataPath(path);
        const meta = next.fixtures.get(metaPath) ?? before.fixtures.get(metaPath);
        const table = meta ? JSON.parse(toText(meta)).definition.name : /^fixtures\/([^/]+)\.(csv|xlsx)$/.exec(path)?.[1];
        if (table) tables.add(table);
      }
      for (const table of tables) send({ kind: 'table.changed', table });
      // Name-only subscriptions continue to work after definition changes.
      if (!tables.size && next.fixtures !== before.fixtures) for (const table of fixtureIds(next.fixtures)) send({ kind: 'table.changed', table });
    });
    function onMessage(event: MessageEvent) {
      const captured = identity.current;
      const source = frame.current?.contentWindow;
      if (!captured || event.source !== source || event.data?.token !== captured.token) return;
      const message = event.data;
      if (message.kind === 'preview.error') { studio.flash(`Preview: ${String(message.message)}`); return; }
      if (message.kind !== 'table.request') return;
      const isCurrent = () => identity.current === captured && frame.current?.contentWindow === source;
      const reply = (ok: boolean, value?: unknown, error?: string) => {
        if (isCurrent()) source?.postMessage({ token: captured.token, id: message.id, ok, value, error }, '*');
      };
      studio.tableRequest(captured.generation, message.table, message.op, message.payload, isCurrent, message.protocol === 2 ? 2 : 1)
        .then(value => reply(true, value))
        .catch(error => { reply(false, undefined, String(error instanceof Error ? error.message : error)); if (isCurrent()) studio.report(error); });
    }
    window.addEventListener('message', onMessage);
    return () => { unsubscribe(); window.removeEventListener('message', onMessage); };
  }, [studio]);

  return <section className="preview-pane"><div className="pane-label"><span className="preview-live"><span /> LIVE PREVIEW</span><span className="preview-address">index.html</span><button onClick={() => setLocalReload(value => value + 1)} title="Reload preview"><RefreshCw size={14} /></button></div><div className="preview-canvas">{build && build.generation === generation ? <iframe ref={frame} key={build.token} title="Project preview" sandbox="allow-scripts allow-forms" srcDoc={build.doc} /> : <span className="preview-loading">Preparing preview…</span>}</div></section>;
});
