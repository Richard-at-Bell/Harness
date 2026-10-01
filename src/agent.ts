import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { createModels, Type, contentText } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { fixtureIds, readTable, tableBytes, type Row } from './fixtures';
import { DEFAULT_MODEL } from './models';
import { finishedTool, startedTool } from './toolActivity';
import type { Stage, ToolLine } from './workspace';
import { toText } from './workspace';

export { DEFAULT_MODEL };

const systemPrompt = `You are the coding agent in a browser project studio. The user's project is plain HTML, CSS, and JavaScript. You can inspect and change project files with the supplied tools. There is no terminal, package manager, server, or TypeScript in the user project. Keep changes small and runnable as a static website. The project includes a data-store.js adapter exposing window.StudioData.list/insert/update/remove/subscribe for CSV or XLSX fixtures. Fixtures are managed by the studio, separate from project source files. Preserve the adapter unless the user explicitly asks to change data behavior. Use list_tables, read_table, and write_table for fixture data. New scalar fields written by the app or write_table automatically become fixture columns; the schema can grow when adding app features. Preserve existing rows and values when extending it. Read relevant files and fixtures before editing. Never claim to have run code or tested a preview. After edits, briefly summarize what changed and any limits. Do not request or print credentials.`;

function result(text: string) { return { content: [{ type: 'text' as const, text }], details: {} }; }

export function createTools(stage: Stage): AgentTool[] {
  const list: AgentTool = {
    name: 'list_files', label: 'List files', description: 'List all project-relative paths.', parameters: Type.Object({}),
    async execute() { return result(stage.list().join('\n')); },
  };
  const listTables: AgentTool = {
    name: 'list_tables', label: 'List Studio fixtures', description: 'List named CSV/XLSX fixture tables managed by Studio data.', parameters: Type.Object({}),
    async execute() { return result(fixtureIds(stage.fixtures).join('\n')); },
  };
  const read: AgentTool = {
    name: 'read_file', label: 'Read file', description: 'Read a UTF-8 project file by relative path.', parameters: Type.Object({ path: Type.String() }),
    async execute(_id, input) {
      const { path } = input as { path: string };
      if (path.endsWith('.xlsx')) throw new Error('Use read_table for XLSX fixtures');
      const bytes = stage.read(path);
      if (!bytes) throw new Error(`File not found: ${path}`);
      if (bytes.byteLength > 100_000) throw new Error('File is too large to read with this tool');
      return result(toText(bytes));
    },
  };
  const write: AgentTool = {
    name: 'write_file', label: 'Write file', description: 'Create or replace a UTF-8 project file. Use for complete new files or substantial rewrites.', parameters: Type.Object({ path: Type.String(), content: Type.String() }), executionMode: 'sequential',
    async execute(_id, input) { const { path, content } = input as { path: string; content: string }; if (path.endsWith('.xlsx')) throw new Error('Use write_table for XLSX fixtures'); stage.write(path, content); return result(`Wrote ${path} (${content.length} characters).`); },
  };
  const edit: AgentTool = {
    name: 'edit_file', label: 'Edit file', description: 'Replace one exact text occurrence in an existing UTF-8 file.', parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }), executionMode: 'sequential',
    async execute(_id, input) {
      const { path, oldText, newText } = input as { path: string; oldText: string; newText: string };
      if (path.endsWith('.xlsx')) throw new Error('Use write_table for XLSX fixtures');
      if (!stage.read(path)) throw new Error(`File not found: ${path}`);
      if (!oldText) throw new Error('oldText cannot be empty');
      const original = stage.text(path);
      const first = original.indexOf(oldText);
      if (first < 0) throw new Error('Exact text was not found');
      if (original.indexOf(oldText, first + oldText.length) >= 0) throw new Error('Exact text occurs more than once');
      stage.write(path, original.slice(0, first) + newText + original.slice(first + oldText.length));
      return result(`Edited ${path}.`);
    },
  };
  const remove: AgentTool = {
    name: 'delete_file', label: 'Delete file', description: 'Remove a project file by relative path.', parameters: Type.Object({ path: Type.String() }), executionMode: 'sequential',
    async execute(_id, input) { const { path } = input as { path: string }; if (!stage.read(path)) throw new Error(`File not found: ${path}`); stage.remove(path); return result(`Deleted ${path}.`); },
  };
  const readTableTool: AgentTool = {
    name: 'read_table', label: 'Read fixture table', description: 'Read a CSV or XLSX fixture by table name. Returns columns and rows as JSON.', parameters: Type.Object({ table: Type.String() }),
    async execute(_id, input) {
      const { table } = input as { table: string };
      if (!/^[a-z0-9_-]{1,60}$/i.test(table)) throw new Error('Invalid table name');
      const value = await readTable(stage.fixtures, table);
      if (value.rows.length > 1000) throw new Error('Table is too large for this tool');
      return result(JSON.stringify({ columns: value.columns, rows: value.rows }));
    },
  };
  const writeTableTool: AgentTool = {
    name: 'write_table', label: 'Write fixture table', description: 'Replace rows of an existing CSV or XLSX fixture. Existing columns are preserved; new scalar fields in rows add columns automatically. Read it first and include all rows to keep them.', parameters: Type.Object({ table: Type.String(), rows: Type.Array(Type.Record(Type.String(), Type.Any())) }), executionMode: 'sequential',
    async execute(_id, input) {
      const { table, rows } = input as { table: string; rows: unknown[] };
      if (!/^[a-z0-9_-]{1,60}$/i.test(table)) throw new Error('Invalid table name');
      if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Table must have at most 1000 rows');
      const current = await readTable(stage.fixtures, table);
      const clean: Row[] = rows.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid row ${index + 1}`);
        const raw = item as Record<string, unknown>;
        return Object.fromEntries([...new Set([...current.columns, ...Object.keys(raw)])].map(column => {
          const value = raw[column];
          if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Invalid ${column} value in row ${index + 1}`);
          return [column, (value ?? null) as Row[string]];
        }));
      });
      stage.writeFixtureBytes(current.path, await tableBytes({ ...current, rows: clean }));
      const saved = await readTable(stage.fixtures, table);
      return result(`Wrote ${clean.length} rows to ${current.path}. Columns: ${saved.columns.join(', ')}.`);
    },
  };
  return [list, listTables, read, write, edit, remove, readTableTool, writeTableTool];
}

export type AgentCallbacks = {
  onText: (text: string) => void;
  onTool: (line: ToolLine) => void;
};

export async function runAgent(prompt: string, key: string, modelId: string, stage: Stage, prior: unknown[], callbacks: AgentCallbacks): Promise<{ text: string; messages: AgentMessage[] }> {
  const models = createModels();
  models.setProvider(openrouterProvider());
  const listedModel = models.getModel('openrouter', modelId);
  if (!listedModel) throw new Error(`OpenRouter model is not in the installed catalog: ${modelId}`);
  // OpenRouter's browser CORS policy allows its Chat Completions transport.
  // Its Anthropic Messages transport requires headers unavailable to browser preflight.
  const model = listedModel.api === 'anthropic-messages'
    ? { ...listedModel, api: 'openai-completions' as const, baseUrl: 'https://openrouter.ai/api/v1', compat: { thinkingFormat: 'openrouter' as const } }
    : listedModel;
  const agent = new Agent({
    initialState: { systemPrompt, model, tools: createTools(stage), messages: prior.length ? prior as AgentMessage[] : undefined },
    streamFn: (selected, context, options) => models.streamSimple(selected, context, { ...options, apiKey: key }),
    toolExecution: 'sequential',
  });
  let streamed = '';
  const activeTools = new Map<string, { line: ToolLine; started: number }>();
  agent.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      streamed += event.assistantMessageEvent.delta;
      callbacks.onText(streamed);
    }
    if (event.type === 'tool_execution_start') {
      const line = startedTool(event.toolCallId, event.toolName, event.args || {}, new Date().toISOString());
      activeTools.set(event.toolCallId, { line, started: performance.now() });
      callbacks.onTool(line);
    }
    if (event.type === 'tool_execution_end') {
      const active = activeTools.get(event.toolCallId);
      const line = active?.line || startedTool(event.toolCallId, event.toolName, {}, new Date().toISOString());
      callbacks.onTool(finishedTool(line, event.isError, event.result, Math.max(0, Math.round(performance.now() - (active?.started ?? performance.now())))));
      activeTools.delete(event.toolCallId);
    }
  });
  await agent.prompt(prompt);
  const last = [...agent.state.messages].reverse().find(message => message.role === 'assistant');
  if (!last || last.role !== 'assistant') throw new Error(agent.state.errorMessage || 'Model returned no assistant response');
  if (last.stopReason === 'error' || last.stopReason === 'aborted') throw new Error(last.errorMessage || agent.state.errorMessage || `Model stopped: ${last.stopReason}`);
  const text = last && last.role === 'assistant' ? contentText(last.content) : streamed;
  if (!text.trim() && !stage.changes().length) throw new Error('Model returned an empty response');
  return { text, messages: agent.state.messages };
}
