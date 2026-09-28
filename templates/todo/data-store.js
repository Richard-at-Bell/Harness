/* This adapter works in Studio preview and in the exported standalone site. */
(function () {
  const token = window.__STUDIO_BRIDGE_TOKEN__;
  const storeKey = 'browser-project-studio:todos';
  const listeners = new Map();
  const pending = new Map();
  let sequence = 0;

  function notify(table) { for (const callback of listeners.get(table) || []) callback(); }
  function localRows(table) {
    const saved = localStorage.getItem(storeKey + ':' + table);
    return saved ? JSON.parse(saved) : structuredClone((window.__FIXTURE_SEED__ || {})[table] || []);
  }
  function saveLocal(table, rows) { localStorage.setItem(storeKey + ':' + table, JSON.stringify(rows)); notify(table); }

  if (token) {
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.data?.token !== token) return;
      if (event.data?.kind === 'table.changed') { notify(event.data.table); return; }
      const item = pending.get(event.data?.id);
      if (!item) return;
      pending.delete(event.data.id);
      event.data.ok ? item.resolve(event.data.value) : item.reject(new Error(event.data.error || 'Table request failed'));
    });
  }
  function request(op, table, payload) {
    if (token) return new Promise((resolve, reject) => {
      const id = String(++sequence);
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ kind: 'table.request', token, id, op, table, payload }, '*');
      setTimeout(() => { if (pending.delete(id)) reject(new Error('Studio data bridge timed out')); }, 10000);
    });
    const rows = localRows(table);
    if (op === 'list') return Promise.resolve(rows);
    if (op === 'insert') {
      const row = { ...payload, id: payload.id || crypto.randomUUID() };
      rows.push(row); saveLocal(table, rows); return Promise.resolve(row);
    }
    const index = rows.findIndex(row => String(row.id) === String(payload.id));
    if (index < 0) return Promise.reject(new Error('Row not found'));
    if (op === 'update') { rows[index] = { ...rows[index], ...payload.patch }; saveLocal(table, rows); return Promise.resolve(rows[index]); }
    if (op === 'remove') { const [row] = rows.splice(index, 1); saveLocal(table, rows); return Promise.resolve(row); }
    return Promise.reject(new Error('Unsupported operation'));
  }
  window.StudioData = {
    list: table => request('list', table),
    insert: (table, row) => request('insert', table, row),
    update: (table, id, patch) => request('update', table, { id, patch }),
    remove: (table, id) => request('remove', table, { id }),
    subscribe(table, callback) {
      const set = listeners.get(table) || new Set(); set.add(callback); listeners.set(table, set);
      return () => set.delete(callback);
    },
    download(table) {
      return this.list(table).then(rows => {
        const fields = Object.keys(rows[0] || {});
        const esc = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
        const csv = [fields.join(','), ...rows.map(row => fields.map(field => esc(row[field])).join(','))].join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const link = document.createElement('a'); link.href = url; link.download = `${table}.csv`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }
  };
})();
