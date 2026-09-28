import type { ToolLine } from './workspace';

type ToolArgs = Record<string, unknown>;

function target(args: ToolArgs): string {
  if (typeof args.path === 'string') return args.path;
  if (typeof args.table === 'string') return `fixtures/${args.table}`;
  return 'Workspace';
}

function inputSummary(name: string, args: ToolArgs): string {
  if (name === 'edit_file') return `Replace ${typeof args.oldText === 'string' ? args.oldText.length : 0} with ${typeof args.newText === 'string' ? args.newText.length : 0} characters`;
  if (name === 'write_file') return `Write ${typeof args.content === 'string' ? args.content.length : 0} characters`;
  if (name === 'write_table') { const count = Array.isArray(args.rows) ? args.rows.length : 0; return `Write ${count} ${count === 1 ? 'row' : 'rows'}`; }
  if (name === 'read_file') return 'Read project file';
  if (name === 'read_table') return 'Read Studio fixture';
  if (name === 'list_tables') return 'List Studio fixtures';
  if (name === 'delete_file') return 'Delete project file';
  return 'List project files';
}

export function startedTool(id: string, name: string, args: ToolArgs, time: string): ToolLine {
  return { id, name, time, status: 'started', summary: target(args), input: inputSummary(name, args) };
}

export function finishedTool(start: ToolLine, isError: boolean, result: unknown, durationMs: number): ToolLine {
  const content = result && typeof result === 'object' && 'content' in result ? (result as { content?: unknown }).content : undefined;
  const chars = Array.isArray(content) ? content.reduce<number>((sum, item) => sum + (item && typeof item.text === 'string' ? item.text.length : 0), 0) : 0;
  return { ...start, status: isError ? 'error' : 'ok', output: isError ? 'Tool failed' : `${chars} response characters`, durationMs };
}
