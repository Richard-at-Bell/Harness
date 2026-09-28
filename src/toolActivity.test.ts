import { describe, expect, it } from 'vitest';
import { finishedTool, startedTool } from './toolActivity';

describe('tool activity debug metadata', () => {
  it('keeps useful counts and timing without storing file content or result text', () => {
    const start = startedTool('call-1', 'edit_file', { path: 'app.js', oldText: 'private old content', newText: 'private new content' }, '2026-01-01T00:00:00.000Z');
    const end = finishedTool(start, false, { content: [{ type: 'text', text: 'private result text' }] }, 81);

    expect(end).toMatchObject({ summary: 'app.js', input: 'Replace 19 with 19 characters', output: '19 response characters', durationMs: 81, status: 'ok' });
    expect(JSON.stringify(end)).not.toContain('private');
  });

  it('reports row counts and errors without including row values', () => {
    const start = startedTool('call-2', 'write_table', { table: 'todos', rows: [{ title: 'private task' }] }, '2026-01-01T00:00:00.000Z');
    const end = finishedTool(start, true, { content: [{ type: 'text', text: 'private failure details' }] }, 12);

    expect(end).toMatchObject({ summary: 'fixtures/todos', input: 'Write 1 row', output: 'Tool failed', status: 'error' });
    expect(JSON.stringify(end)).not.toContain('private');
  });
});
