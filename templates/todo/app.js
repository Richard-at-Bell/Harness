const listEl = document.getElementById('task-list');
const countEl = document.getElementById('open-count');
const statusEl = document.getElementById('status');
const formEl = document.getElementById('task-form');
const inputEl = document.getElementById('new-task');

async function render() {
  try {
    const rows = await window.StudioData.list('todos');
    const ordered = [...rows].sort((a, b) => Number(a.completed) - Number(b.completed));
    listEl.replaceChildren();
    countEl.textContent = String(rows.filter(row => !row.completed).length);
    statusEl.textContent = `${rows.length} total`;
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Nothing on your list yet. Add your first task above.';
      listEl.append(empty);
    }
    for (const row of ordered) {
      const item = document.createElement('div');
      item.className = `task-row${row.completed ? ' done' : ''}`;
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = Boolean(row.completed);
      check.setAttribute('aria-label', `Complete ${row.title}`);
      check.addEventListener('change', async () => { await window.StudioData.update('todos', row.id, { completed: check.checked }); await render(); });
      const title = document.createElement('input');
      title.className = 'task-title';
      title.value = row.title;
      title.setAttribute('aria-label', 'Task title');
      title.addEventListener('change', async () => { if (title.value.trim()) await window.StudioData.update('todos', row.id, { title: title.value.trim() }); await render(); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete ${row.title}`);
      remove.addEventListener('click', async () => { await window.StudioData.remove('todos', row.id); await render(); });
      item.append(check, title, remove);
      listEl.append(item);
    }
  } catch (error) {
    statusEl.textContent = 'Unable to read tasks';
    const message = document.createElement('p');
    message.className = 'empty error';
    message.textContent = String(error.message || error);
    listEl.replaceChildren(message);
  }
}

formEl.addEventListener('submit', async event => {
  event.preventDefault();
  const title = inputEl.value.trim();
  if (!title) return;
  try {
    await window.StudioData.insert('todos', { title, completed: false, created_at: new Date().toISOString() });
    inputEl.value = '';
    await render();
  } catch (error) {
    statusEl.textContent = String(error.message || error);
  }
});
window.StudioData.subscribe('todos', render);
document.getElementById('download-table').addEventListener('click', () => window.StudioData.download('todos'));
render();
