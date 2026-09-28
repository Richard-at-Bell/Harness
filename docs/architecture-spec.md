# Architecture and contracts

Status: **Draft for review** · Related decisions: [D-003](decisions.md#d-003-browser-workspace), [D-004](decisions.md#d-004-preview-runtime), [D-005](decisions.md#d-005-agent-integration)

## Runtime shape

```text
Vercel static assets
  └─ TypeScript studio application
       ├─ Monaco editor + diff view
       ├─ chat and Pi agent loop
       ├─ workspace service ── OPFS source files
       │                    └─ IndexedDB metadata, checkpoints, sessions
       ├─ fixture service ── normalized tables ↔ CSV/XLSX files
       ├─ preview builder ── isolated iframe + data bridge
       └─ exporter ── versioned ZIP

User key ── Pi model provider request
```

The workspace service is the sole writer of project files. Monaco, agent tools, fixture operations, preview data writes, and export all use it. It maintains an accepted revision and, during an agent turn, a staged branch based on that revision. This avoids separate copies of a file drifting apart.

## Workspace contract

All paths are project-relative POSIX paths. Reject absolute paths, `..` traversal, duplicate normalized paths, and writes to studio-owned records. Binary files are supported for images and XLSX; Monaco opens only supported text files.

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

`expectedRevision` rejects stale writes. Agent tools see their staged branch, including their earlier edits in the same turn. Acceptance atomically advances the accepted revision only when its base is still current; otherwise the user sees a conflict and can review again. The UI labels changes from the user, agent, fixture editor, or preview.

OPFS stores project bytes. IndexedDB stores project records, chat and tool events, snapshot metadata, and ZIP import provenance. Save operations are journaled so an interrupted write can be recovered or rolled back on reload. Browser storage remains subject to quota and deletion by the browser or user; export is the durable handoff.

## Agent seam

Use `@earendil-works/pi-agent-core` for the browser tool loop and `@earendil-works/pi-ai` for supported provider calls. The full `pi-coding-agent` SDK embeds in Node/Bun, so its default shell and file tools are not the browser implementation. Define a small, versioned set of custom tools: `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file`, `read_table`, and `write_table`. The agent cannot invoke a shell in the first release.

Every tool call records time, turn ID, tool name, arguments with known credentials removed, result status, affected paths, and resulting revisions. A turn starts from the accepted revision. The agent can inspect current files, but its writes are staged for the user's review. Accept commits the staged revision; revert discards that branch. New user edits made during an active turn trigger a revision conflict instead of an automatic overwrite.

The key is entered by the user and held in session memory by default. It is passed only to the model request path. The studio never intentionally writes it to workspace files, preview messages, telemetry, logs, or ZIPs. Imported `.env` and credential files are rejected; known key values are redacted from chat/tool exports. Users can still type other secrets into project content, so export includes a content review step. If a provider cannot be called from the browser due to its network or authentication rules, the UI reports that provider as unsupported for this deployment; it does not expose a platform key.

## Live preview seam

The first release supports static HTML, CSS, JavaScript, images, and fixture tables. A preview builder reads an accepted workspace snapshot and materializes an iframe document. It resolves local CSS/JS/assets and injects a narrow table adapter. Accepted code or asset changes rebuild the preview. Table writes update the fixture file and notify the running preview without reloading its document. Preview state is reset when code reloads, while table state persists. A preview table write while an agent stage exists changes the accepted revision, so accepting the stage requires another review of the resulting conflict.

The iframe uses a sandbox that permits scripts but gives the page an opaque origin. It must not combine `allow-scripts` and `allow-same-origin` for a studio-origin document. Communication uses `postMessage` with a per-preview capability token, an allowlist of message types, path/table validation, payload limits, and revision checks. The preview receives no direct OPFS handle, model key, or parent DOM access. External network requests are blocked in the first release; allowing them later requires an explicit product decision and CSP review. [MDN iframe guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)

The bridge request types are `table.list`, `table.read`, and `table.mutate`; responses include success or a structured error. Mutations are serial and produce a new table revision. Preview console and runtime errors are forwarded to the studio with bounded message sizes. The exact preview materialization method needs a prototype to verify multi-file paths, assets, CSV/XLSX reads, and isolation before implementation is considered settled.

## Import, export, and migration seams

ZIP import first validates paths, sizes, and supported file types into a temporary workspace. A studio export must also have a supported manifest and required entries; a plain project ZIP may omit studio metadata but must contain an `index.html` entry point. Import swaps the active workspace only after validation succeeds. ZIP export reads one consistent snapshot so `project/`, fixtures, and the manifest describe the same revision. Importing a studio ZIP created by an older schema runs a versioned migration; an unknown newer version opens read-only or fails with a clear message.

## Package candidates and evidence

| Need | Candidate | Note |
| --- | --- | --- |
| Editor/diff | [Monaco](https://microsoft.github.io/monaco-editor/) | Editor models must be synchronized with workspace revisions. |
| Agent loop/model calls | [Pi agent core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) + [Pi AI](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) | Browser tool and auth adapter are our code. |
| CSV | [Papa Parse](https://github.com/mholt/PapaParse) | Browser parsing and serialization. |
| XLSX | [ExcelJS](https://github.com/exceljs/exceljs) | Candidate pending an actual browser round-trip and bundle-size spike. |
| ZIP | [zip.js](https://github.com/gildas-lormeau/zip.js/) | Validate streaming and large-file behavior in the target browser. |

WebContainers remain a later option if the product expands to npm-based projects. They require cross-origin isolation and a commercial license for commercial production use; those costs are unnecessary for the proposed static-site scope. See [vendor quickstart](https://webcontainers.io/guides/quickstart) and [commercial terms](https://webcontainers.io/enterprise).
