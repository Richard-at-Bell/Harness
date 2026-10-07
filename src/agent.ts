import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { createModels, Type, contentText } from '@earendil-works/pi-ai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { fixtureIds, type Row } from './fixtures';
import { DEFAULT_MODEL } from './models';
import { finishedTool, startedTool } from './toolActivity';
import { DatasetService } from './datasetService';
import { inferField, type DatasetPolicy, type Field, type Mutation } from './datasets';
import type { AgentChange } from './agentChanges';
import type { Stage, ToolLine } from './workspace';
import { copyFiles, sameBytes, toText, validFixturePath } from './workspace';

export { DEFAULT_MODEL };

const systemPrompt = `You are the coding agent in a browser project studio. The user's project is plain HTML, CSS, and JavaScript. You can inspect and change project files with the supplied tools. There is no terminal, package manager, server, or TypeScript in the user project. Keep changes small and runnable as a static website. The preview runs in a sandboxed iframe without native dialogs. Use accessible in-page dialogs for confirmations and messages; do not use window.alert, window.confirm, or window.prompt. The project includes a data-store.js adapter exposing window.StudioData.list/insert/update/remove/subscribe for CSV or XLSX fixtures. Fixtures are managed by the studio, separate from project source files. Preserve the adapter unless the user explicitly asks to change data behavior. Use list_tables and paginated read_table to inspect fixture definitions, revisions and row handles. Use create_table with typed fields, insert_row/update_row/remove_row with an expected revision for targeted changes. write_table requires replaceAll=true and replaces the complete dataset, so never use it for a page edit. A missing table needs create_table; do not work around missing fixtures by rewriting data-store.js, creating fixture-seed.js, or putting fixture files in the project. The studio generates fixture-seed.js from managed fixtures for preview and export. Generic grow schemas add new scalar fields and values atomically; fixed schemas reject additions. Respect types, read-only fields and declared identity. Preserve existing rows and values when extending it. Read relevant files and fixtures before editing. Never claim to have run code or tested a preview. After edits, briefly summarize what changed and any limits. Do not request or print credentials.`;

function result(text: string) { return { content: [{ type: 'text' as const, text }], details: {} }; }

type ToolOptions = { datasetPolicy?: DatasetPolicy; beforeTool?: () => Promise<void>; onChange?: (change: AgentChange) => Promise<void> };

export function createTools(stage: Stage, options: ToolOptions = {}): AgentTool[] {
  async function change(path: string, update: () => void) {
    const before = stage.readCurrent(path);
    update();
    try { await options.onChange?.({ path, before, after: stage.readCurrent(path) }); }
    catch (error) {
      const files = validFixturePath(path) ? stage.fixtures : stage.files;
      if (before) files.set(path, before); else files.delete(path);
      throw error;
    }
  }
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
    async execute(_id, input) { const { path, content } = input as { path: string; content: string }; if (path.startsWith('fixtures/') || path.endsWith('.xlsx')) throw new Error('Use create_table for new Studio fixtures or write_table for existing fixtures'); await change(path, () => stage.write(path, content)); return result(`Wrote ${path} (${content.length} characters).`); },
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
      await change(path, () => stage.write(path, original.slice(0, first) + newText + original.slice(first + oldText.length)));
      return result(`Edited ${path}.`);
    },
  };
  const remove: AgentTool = {
    name: 'delete_file', label: 'Delete file', description: 'Remove a project file by relative path.', parameters: Type.Object({ path: Type.String() }), executionMode: 'sequential',
    async execute(_id, input) { const { path } = input as { path: string }; if (!stage.read(path)) throw new Error(`File not found: ${path}`); await change(path, () => stage.remove(path)); return result(`Deleted ${path}.`); },
  };
  const service = new DatasetService({ get fixtures() { return stage.fixtures; }, async writeFixture(path, bytes) { stage.writeFixtureBytes(path, bytes); }, async removeFixture(path) { stage.fixtures.delete(path); } }, options.datasetPolicy);
  async function datasetChange(operation: () => Promise<unknown>) {
    const before = copyFiles(stage.fixtures);
    try {
      const value = await operation();
      const paths = [...new Set([...before.keys(), ...stage.fixtures.keys()])].filter(p => !sameBytes(before.get(p), stage.fixtures.get(p)));
      if (paths.length) {
        const changes = paths.map(path => ({ path, before: before.get(path), after: stage.fixtures.get(path) }));
        await options.onChange?.({ ...changes[0], related: changes.slice(1) });
      }
      return value;
    } catch (error) { stage.fixtures = before; throw error; }
  }
  const readTableTool: AgentTool = {
    name: 'read_table', label: 'Read fixture page', description: 'Read a bounded page of typed rows, Studio handles, definition and revision. Default 100 rows; maximum 1000 per page. Follow nextOffset to continue.',
    parameters: Type.Object({ table: Type.String(), offset: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()) }),
    async execute(_id, input) { const { table, offset, limit } = input as { table: string; offset?: number; limit?: number }; return result(JSON.stringify(await service.page(table, offset, limit))); },
  };
  const writeTableTool: AgentTool = {
    name: 'write_table', label: 'Replace complete dataset', description: 'Explicit complete-row replacement. Requires replaceAll=true and the revision from read_table. Do not use for page edits; use targeted row tools to preserve unread rows.',
    parameters: Type.Object({ table: Type.String(), rows: Type.Array(Type.Record(Type.String(), Type.Any())), replaceAll: Type.Boolean(), revision: Type.Number() }), executionMode: 'sequential',
    async execute(_id, input) {
      const { table, rows, replaceAll, revision } = input as { table: string; rows: Row[]; replaceAll: boolean; revision: number };
      if (replaceAll !== true) throw new Error('Complete replacement requires replaceAll=true; use targeted row tools for pages');
      if (!Array.isArray(rows) || rows.length > 100_000) throw new Error('Invalid or oversized rows');
      await datasetChange(() => service.mutate(table, { op: 'replace', rows }, revision));
      return result(`Wrote ${rows.length} rows to ${table}.`);
    },
  };
  const createTableTool: AgentTool = {
    name: 'create_table', label: 'Create fixture table', description: 'Create a case-preserving dataset with ordered typed fields, optional rows, schemaPolicy and rowIdentity. Legacy columns shorthand infers only native value types. Never overwrites an existing name.',
    parameters: Type.Object({ table: Type.String(), columns: Type.Optional(Type.Array(Type.String())), fields: Type.Optional(Type.Array(Type.Any())), rows: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))), format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('xlsx')])), schemaPolicy: Type.Optional(Type.Union([Type.Literal('grow'), Type.Literal('fixed')])), rowIdentity: Type.Optional(Type.String()) }), executionMode: 'sequential',
    async execute(_id, input) {
      const { table, columns, fields, rows = [], format = 'csv', schemaPolicy, rowIdentity } = input as { table: string; columns?: string[]; fields?: Omit<Field, 'id'>[]; rows?: Row[]; format?: 'csv' | 'xlsx'; schemaPolicy?: 'grow' | 'fixed'; rowIdentity?: string };
      if (!Array.isArray(rows) || rows.length > 1000 || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('Create at most 1000 valid initial rows; add more with targeted tools');
      if (!fields && (!Array.isArray(columns) || !columns.length || columns.some(c => typeof c !== 'string' || !c.trim()) || new Set(columns).size !== columns.length)) throw new Error('Fixture columns must have unique, nonempty names');
      const declared = fields ?? columns!.map(name => ({ ...inferField(name, rows.map(r => r[name])), ...(name === 'id' ? { type: 'text' as const, nullable: false, default: { generate: 'uuid' as const } } : {}) }));
      const created = await datasetChange(() => service.create({ name: table, fields: declared, rows, format, schemaPolicy, rowIdentity: rowIdentity ?? (!fields && columns?.includes('id') ? 'id' : undefined) }));
      const dataset = created as Awaited<ReturnType<typeof service.read>>;
      return result(JSON.stringify({ definition: dataset.definition, revision: dataset.revision, total: dataset.rows.length, format: dataset.format }));
    },
  };
  const rowTools: AgentTool[] = (['insert', 'update', 'remove'] as const).map(op => ({
    name: `${op}_row`, label: `${op} row`, description: `${op} a single row using its Studio handle and expected dataset revision. Preserves all other rows.`,
    parameters: Type.Object({ table: Type.String(), revision: Type.Number(), ...(op === 'insert' ? { row: Type.Record(Type.String(), Type.Any()) } : { handle: Type.String(), ...(op === 'update' ? { patch: Type.Record(Type.String(), Type.Any()) } : {}) }) }), executionMode: 'sequential',
    async execute(_id, input) {
      const args = input as { table: string; revision: number; handle: string; row: Row; patch: Row };
      const mutation: Mutation = op === 'insert' ? { op, row: args.row } : op === 'update' ? { op, handle: args.handle, patch: args.patch } : { op, handle: args.handle };
      const saved = await datasetChange(() => service.mutate(args.table, mutation, args.revision));
      const dataset = saved as Awaited<ReturnType<typeof service.read>>;
      return result(JSON.stringify({ revision: dataset.revision, definition: dataset.definition, handle: op === 'insert' ? dataset.handles.at(-1) : args.handle }));
    },
  }));
  return [list, listTables, read, write, edit, remove, readTableTool, createTableTool, writeTableTool, ...rowTools].map(tool => ({
    ...tool,
    async execute(...args: Parameters<AgentTool['execute']>) { await options.beforeTool?.(); return tool.execute(...args); },
  }));
}

export type AgentCallbacks = ToolOptions & {
  signal?: AbortSignal;
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
    initialState: { systemPrompt: `${systemPrompt}\n${callbacks.onChange ? 'Review is off. Each successful edit is applied immediately to the project and live preview.' : 'Review is on. Your edits are staged until the user accepts the turn.'}`, model, tools: createTools(stage, callbacks), messages: prior.length ? structuredClone(prior) as AgentMessage[] : undefined },
    streamFn: (selected, context, options) => models.streamSimple(selected, context, { ...options, apiKey: key }),
    toolExecution: 'sequential',
  });
  let streamed = '';
  const activeTools = new Map<string, { line: ToolLine; started: number }>();
  const unsubscribe = agent.subscribe(event => {
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
  const onAbort = () => agent.abort();
  callbacks.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (callbacks.signal?.aborted) throw new Error('Agent turn cancelled');
    await agent.prompt(prompt);
  } finally {
    unsubscribe(); callbacks.signal?.removeEventListener('abort', onAbort);
  }
  const last = [...agent.state.messages].reverse().find(message => message.role === 'assistant');
  if (!last || last.role !== 'assistant') throw new Error(agent.state.errorMessage || 'Model returned no assistant response');
  if (last.stopReason === 'error' || last.stopReason === 'aborted') throw new Error(last.errorMessage || agent.state.errorMessage || `Model stopped: ${last.stopReason}`);
  const text = last && last.role === 'assistant' ? contentText(last.content) : streamed;
  if (!text.trim() && !stage.changes().length) throw new Error('Model returned an empty response');
  return { text, messages: agent.state.messages };
}
