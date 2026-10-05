# Architecture and contracts

Status: **Draft for review** · Related decisions: [D-003](decisions.md#d-003-browser-workspace), [D-004](decisions.md#d-004-preview-runtime), [D-005](decisions.md#d-005-agent-integration)

## Runtime shape

```text
Vercel static assets
  └─ TypeScript studio application
       ├─ Monaco editor + diff view
       ├─ chat and Pi agent loop
       ├─ workspace service ── IndexedDB project/fixture revisions
       │                    └─ atomic manifests, byte records and activation metadata
       ├─ chat store ── IndexedDB conversations and active chat (same database)
       ├─ fixture service ── normalized tables ↔ Studio CSV/XLSX files
       ├─ preview builder ── isolated iframe + data bridge
       └─ exporter ── versioned ZIP

User key ── Pi model provider request
```

The workspace service commits project files and Studio fixtures as separate namespaces within one versioned IndexedDB manifest. Monaco, agent tools, fixture operations, preview data writes, and export all use it. Review is on by default: an agent turn works in a staged branch based on the accepted revision. With review off, each successful mutation advances the accepted workspace immediately. Multiple chats share these files but keep separate conversation state.

The implemented reactive ownership and lifecycle boundaries are documented in the [state ownership map](state-ownership.md).

## Workspace contract

Project paths are project-relative POSIX paths. `fixtures/` is reserved for Studio data and unavailable to project file tools. Reject absolute paths, `..` traversal, duplicate normalized paths, and writes to studio-owned records. Binary files are supported for images and XLSX; Monaco opens only supported text files.

```ts
interface Workspace {
  list(prefix?: string): Promise<FileEntry[]>;
  read(path: string): Promise<{ bytes: Uint8Array; revision: string }>;
  write(path: string, bytes: Uint8Array, expectedRevision?: string): Promise<string>;
  remove(path: string, expectedRevision?: string): Promise<void>;
  snapshot(): Promise<WorkspaceSnapshot>;
  beginStage(turnId: string): Promise<WorkspaceStage>;
  acceptStage(stageId: string, expectedBaseRevision: string): Promise<string>;
  discardStage(stageId: string): Promise<void>;
}

interface WorkspaceStage {
  list(prefix?: string): Promise<FileEntry[]>;
  read(path: string): Promise<{ bytes: Uint8Array; revision: string }>;
  write(path: string, bytes: Uint8Array, expectedRevision?: string): Promise<string>;
  remove(path: string, expectedRevision?: string): Promise<void>;
  diff(): Promise<FileDiff[]>;
}
```

`expectedRevision` rejects stale writes. In review mode, agent tools see their staged branch, including their earlier edits in the same turn. Acceptance atomically advances the accepted revision only when its base is still current; otherwise the user sees a conflict and can review again. The UI labels changes from the user, agent, fixture editor, or preview.

IndexedDB stores accepted project/fixture revisions, chats, tool events, and active chat selection. Legacy OPFS roots are read only during migration and retained as backups. Each chat keeps its own Pi context and model selection; the project and fixtures are shared. Browser storage remains subject to quota and deletion by the browser or user; export is the durable handoff. A commit atomically activates changed byte records, the complete manifest and replacement session metadata; see [implemented persistence boundaries](state-ownership.md).

## Agent seam

Use `@earendil-works/pi-agent-core` for the browser tool loop and `@earendil-works/pi-ai` for supported provider calls. The full `pi-coding-agent` SDK embeds in Node/Bun, so its default shell and file tools are not the browser implementation. Define a small, versioned set of custom tools: `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file`, `list_tables`, `read_table`, and `write_table`. Project file tools do not expose fixture bytes. The agent cannot invoke a shell in the first release.

Every tool call records time, turn ID, tool name, arguments with known credentials removed, result status, affected paths, and resulting revisions. A turn starts from the accepted revision. With review on, writes stay staged; acceptance applies the turn only if its starting revision remains current. With review off, tools refresh their view from the workspace before execution, then await persistence of the affected path before reporting success. Accepted workspace operations share one queue protecting complete read-modify-write operations, and each commit compares the current bytes with the tool's starting bytes to detect a concurrent edit. Other files are preserved. Successful automatic edits remain applied if a later part of the turn fails.

The review preference lives in IndexedDB metadata alongside the session and remains outside the exported chat record. It defaults to on, survives reload, and cannot change during a running turn or pending review. The agent's system instructions describe the selected mode. Both modes retain chat and tool activity; automatic mode does not create a pending diff or block the next prompt.

The key is entered by the user and held in session memory by default. It is passed only to the model request path. The studio never intentionally writes it to workspace files, preview messages, telemetry, logs, or ZIPs. Imported `.env` and credential files are rejected; known key values are redacted from chat/tool exports. Users can still type other secrets into project content, so export includes a content review step. If a provider cannot be called from the browser due to its network or authentication rules, the UI reports that provider as unsupported for this deployment; it does not expose a platform key.

## Live preview seam

The first release supports static HTML, CSS, JavaScript, images, and fixture tables. A preview builder reads accepted project files and Studio fixtures to materialize an iframe document. It resolves local CSS/JS/assets and injects a narrow table adapter. Accepted code or asset changes rebuild the preview. Table writes update Studio data and notify the running preview without reloading its document. Preview state is reset when code reloads, while table state persists. A preview table write while an agent stage exists changes the accepted revision, so accepting the stage requires another review of the resulting conflict.

The iframe uses a sandbox that permits scripts but gives the page an opaque origin. It must not combine `allow-scripts` and `allow-same-origin` for a studio-origin document. Communication uses `postMessage` with a per-preview capability token, an allowlist of message types, path/table validation, payload limits, and revision checks. The preview receives no direct OPFS handle, model key, or parent DOM access. External network requests are blocked in the first release; allowing them later requires an explicit product decision and CSP review. [MDN iframe guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)

The bridge request types are `table.list`, `table.read`, and `table.mutate`; responses include success or a structured error. Mutations are serial and produce a new table revision. Preview console and runtime errors are forwarded to the studio with bounded message sizes. The exact preview materialization method needs a prototype to verify multi-file paths, assets, CSV/XLSX reads, and isolation before implementation is considered settled.

## Import, export, and migration seams

ZIP import first validates paths, sizes, and supported file types into a temporary workspace. A studio export must also have a supported manifest and required entries; a plain project ZIP may omit studio metadata but must contain an `index.html` entry point. Import swaps the active workspace only after validation succeeds. ZIP v2 puts authored files in `project/`, fixtures in `studio/fixtures/`, and all transcripts and tool events in Studio metadata. The generated `project/fixture-seed.js` keeps the standalone project runnable. Import migrates v1 project fixtures into Studio data; unknown newer versions fail with a clear message.

## Package candidates and evidence

| Need | Candidate | Note |
| --- | --- | --- |
| Editor/diff | [Monaco](https://microsoft.github.io/monaco-editor/) | Editor models must be synchronized with workspace revisions. |
| Agent loop/model calls | [Pi agent core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) + [Pi AI](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) | Browser tool and auth adapter are our code. |
| CSV | [Papa Parse](https://github.com/mholt/PapaParse) | Browser parsing and serialization. |
| XLSX | [ExcelJS](https://github.com/exceljs/exceljs) | Candidate pending an actual browser round-trip and bundle-size spike. |
| ZIP | [zip.js](https://github.com/gildas-lormeau/zip.js/) | Validate streaming and large-file behavior in the target browser. |

WebContainers remain a later option if the product expands to npm-based projects. They require cross-origin isolation and a commercial license for commercial production use; those costs are unnecessary for the proposed static-site scope. See [vendor quickstart](https://webcontainers.io/guides/quickstart) and [commercial terms](https://webcontainers.io/enterprise).
