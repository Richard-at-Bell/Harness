/* Shared typed data adapter, in Studio and in an exported static project. */
(function () {
  const token = window.__STUDIO_BRIDGE_TOKEN__;
  const kernel = window.__DATASET_KERNEL__;
  const storeKey = 'browser-project-studio:todos';
  const listeners = new Map(), pending = new Map(), revisions = new Map();
  let sequence = 0;
  function notify(table) { for (const callback of listeners.get(table) || []) callback(); }
  function localDataset(table) {
    const seed = window.__DATASET_SEED__?.[table];
    if (!seed || !kernel) throw new Error('Missing dataset definition: ' + table);
    const saved = localStorage.getItem(storeKey + ':' + table);
    const value = saved ? JSON.parse(saved) : null;
    if (value?.version === 1) return value.dataset;
    const rows = Array.isArray(value) ? value : structuredClone(window.__FIXTURE_SEED__?.[table] || []);
    const definition = kernel.growDefinition(seed.definition, rows);
    return { path: '', format: 'csv', columns: definition.fields.map(f => f.name), definition,
      revision: Array.isArray(value) ? 0 : seed.revision,
      handles: Array.isArray(value) ? rows.map(() => crypto.randomUUID()) : [...seed.handles], rows: kernel.normalizeRows(definition, rows) };
  }
  if (token) window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.token !== token) return;
    if (event.data?.kind === 'table.changed') { notify(event.data.table); return; }
    const item = pending.get(event.data?.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(event.data.id);
    if (event.data.ok) { if (event.data.value?.revision != null) revisions.set(item.table, event.data.value.revision); item.resolve(event.data.value?.value); }
    else item.reject(new Error(event.data.error || 'Table request failed'));
  });
  function request(op, table, payload) {
    if (token) return new Promise((resolve, reject) => {
      const id = String(++sequence), timer = setTimeout(() => { if (pending.delete(id)) reject(new Error('Studio data bridge timed out')); }, 10000);
      pending.set(id, { resolve, reject, timer, table });
      window.parent.postMessage({ kind: 'table.request', protocol: 2, token, id, op, table, payload }, '*');
    });
    return Promise.resolve().then(() => {
      const dataset = localDataset(table);
      if (op === 'page') {
        revisions.set(table, dataset.revision);
        return kernel.pageDataset(dataset, payload?.offset, payload?.limit);
      }
      let index = -1, mutation;
      if (op === 'insert') mutation = { op, row: payload.row };
      else {
        index = dataset.handles.indexOf(payload.id);
        if (index < 0 && dataset.definition.rowIdentity) {
          const field = dataset.definition.fields.find(f => f.id === dataset.definition.rowIdentity);
          index = dataset.rows.findIndex(row => String(row[field.name]) === String(payload.id));
        }
        if (index < 0) throw new Error('Row not found; use a Studio handle or declared row identity');
        mutation = op === 'update' ? { op, handle: dataset.handles[index], patch: payload.patch } : { op, handle: dataset.handles[index] };
      }
      const next = kernel.mutateDataset(dataset, mutation, payload.revision ?? dataset.revision);
      localStorage.setItem(storeKey + ':' + table, JSON.stringify({ version: 1, dataset: next }));
      revisions.set(table, next.revision); notify(table);
      return op === 'insert' ? next.rows.at(-1) : op === 'update' ? next.rows[index] : dataset.rows[index];
    });
  }
  window.StudioData = {
    page: (table, options = {}) => request('page', table, options),
    async list(table) {
      let offset = 0, revision, rows = [];
      do {
        const page = await request('page', table, { offset, limit: 1000 });
        if (revision !== undefined && page.revision !== revision) throw new Error('Dataset changed during list; retry');
        revision = page.revision; rows.push(...page.rows); offset = page.nextOffset;
      } while (offset !== null);
      return rows;
    },
    insert: (table, row, options = {}) => request('insert', table, { row, revision: options.revision ?? revisions.get(table) }),
    update: (table, id, patch, options = {}) => request('update', table, { id, patch, revision: options.revision ?? revisions.get(table) }),
    remove: (table, id, options = {}) => request('remove', table, { id, revision: options.revision ?? revisions.get(table) }),
    subscribe(table, callback) {
      const set = listeners.get(table) || new Set(); set.add(callback); listeners.set(table, set); return () => set.delete(callback);
    },
    async download(table) {
      const page = await this.page(table, { limit: 1 }), rows = await this.list(table);
      const esc = value => '"' + String(value).replaceAll('"', '""') + '"';
      const fields = page.definition.fields;
      const csv = [fields.map(f => esc(f.name)).join(','), ...rows.map(row => fields.map(f => esc(kernel.encodeCSVValue(f, row[f.name]))).join(','))].join('\n') + '\n';
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a'); link.href = url; link.download = `${table}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
})();
