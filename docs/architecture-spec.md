# Architecture and contracts

Status: **Implemented contracts updated 2026-10-07** · Related decisions: [D-003](decisions.md#d-003-browser-workspace), [D-004](decisions.md#d-004-preview-runtime), [D-005](decisions.md#d-005-agent-integration)

## Runtime shape

```text
Vercel static assets
  └─ TypeScript studio application
       ├─ Monaco editor + diff view
       ├─ chat and Pi agent loop
       ├─ workspace service ── IndexedDB project/fixture revisions
       │                    └─ atomic manifests, byte records and activation metadata
       ├─ chat store ── IndexedDB conversations and active chat (same database)
       ├─ dataset service ── typed rows + definitions ↔ Studio CSV/XLSX + sidecars
       ├─ preview builder ── isolated iframe + data bridge
       └─ exporter ── versioned ZIP

User key ── Pi model provider request
```

The workspace service commits project files and Studio fixtures as separate namespaces within one versioned IndexedDB manifest. Monaco, agent tools, fixture operations, preview data writes, and export all use it. Review is on by default: an agent turn works in a staged branch based on the accepted revision. With review off, each successful mutation advances the accepted workspace immediately. Multiple chats share these files but keep separate conversation state.

The implemented reactive ownership and lifecycle boundaries are documented in the [state ownership map](state-ownership.md).

## Workspace contract

Project paths are project-relative POSIX paths. `fixtures/` is reserved for Studio data and unavailable to project file tools. Reject absolute paths, `..` traversal, duplicate normalized paths, and writes to studio-owned records. Binary files are supported for images and XLSX; Monaco opens only supported text files.

The implemented API is `Workspace.transaction(operation, activation?)`, with a detached `WorkspaceWriter` exposing project/fixture snapshots, writes/removals, replacement and the captured durable revision. Accepted `Workspace.store` snapshots publish after commit. `Stage` owns detached baseline/current maps; `createAgentTurns` owns review acceptance/discard and base-revision checks. These APIs are in `src/workspace.ts`, `src/workspaceStorage.ts` and `src/agentTurns.ts`.

The storage commit’s `expectedRevision` rejects stale writes across tabs. In review mode, agent tools see their staged branch, including their earlier edits in the same turn. Acceptance atomically advances the accepted revision only when its base is still current; otherwise the user sees a conflict and can review again. The UI labels changes from the user, agent, fixture editor, or preview.

IndexedDB stores accepted project/fixture revisions, chats, tool events, and active chat selection. Legacy OPFS roots are read only during migration and retained as backups. Each chat keeps its own Pi context and model selection; the project and fixtures are shared. Browser storage remains subject to quota and deletion by the browser or user; export is the durable handoff. A commit atomically activates changed byte records, the complete manifest and replacement session metadata; see [implemented persistence boundaries](state-ownership.md).

## Agent seam

Use `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` for browser agent/provider calls. File tools are `list_files`, `read_file`, `write_file`, `edit_file` and `delete_file`. Dataset tools are `list_tables`, paginated `read_table`, `create_table`, targeted `insert_row`/`update_row`/`remove_row`, and explicit complete `write_table` replacement. Targeted edits use stable Studio handles and expected dataset revisions; full replacement additionally requires `replaceAll: true`. Tools cannot write fixture bytes through the project namespace or invoke a shell. Schema/data changes travel as one change group and commit atomically. See [dataset contracts](fixtures-and-export-spec.md).

Every tool call records time, turn ID, tool name, arguments with known credentials removed, result status, affected paths, and resulting revisions. A turn starts from the accepted revision. With review on, writes stay staged; acceptance applies the turn only if its starting revision remains current. With review off, tools refresh their view from the workspace before execution, then await persistence of the complete affected change group before reporting success. Accepted workspace operations share one queue protecting complete read-modify-write operations, and each commit compares the current bytes with the tool's starting bytes to detect a concurrent edit. Other files are preserved. Successful automatic edits remain applied if a later part of the turn fails.

The review preference lives in IndexedDB metadata alongside the session and remains outside the exported chat record. It defaults to on, survives reload, and cannot change during a running turn or pending review. The agent's system instructions describe the selected mode. Both modes retain chat and tool activity; automatic mode does not create a pending diff or block the next prompt.

The key is entered by the user and held in session memory by default. It is passed only to the model request path. The studio never intentionally writes it to workspace files, preview messages, telemetry, logs, or ZIPs. Imported `.env` and credential files are rejected; known key values are redacted from chat/tool exports. Users can still type other secrets into project content, so export includes a content review step. If a provider cannot be called from the browser due to its network or authentication rules, the UI reports that provider as unsupported for this deployment; it does not expose a platform key.

## Live preview seam

The first release supports static HTML, CSS, JavaScript, images, and fixture tables. A preview builder reads accepted project files and Studio fixtures to materialize an iframe document. It resolves local CSS/JS/assets and injects a narrow table adapter. Accepted code or asset changes rebuild the preview. The materializer intercepts same-page fragment links so the inherited `srcdoc` base URL cannot navigate them to the Studio inside the frame. Table writes update Studio data and notify the running preview without reloading its document. Preview state is reset when code reloads, while table state persists. A preview table write while an agent stage exists changes the accepted revision, so accepting the stage requires another review of the resulting conflict.

The iframe uses a sandbox that permits scripts but gives the page an opaque origin. It must not combine `allow-scripts` and `allow-same-origin` for a studio-origin document. Communication uses `postMessage` with a per-preview capability token, an allowlist of message types, path/table validation, payload limits, and revision checks. The preview receives no direct OPFS handle, model key, or parent DOM access. Native alert, confirm, and prompt dialogs are unavailable; authored apps use accessible in-page dialogs instead. The agent instructions state this constraint. External network requests are blocked in the first release; allowing them later requires an explicit product decision and CSP review. [MDN iframe guidance](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)

The implemented message is `table.request` with `list`, `page`, `insert`, `update` or `remove`. Legacy replies preserve their value shape; protocol 2 returns value and dataset revision together. The runtime queues parsing, validation and encoding with both generation and current-preview checks. Preview support is injected before authored head scripts. Project code changes rebuild the iframe; fixture group changes notify dataset display names. Definitions, defaults and the portable validation kernel are generated with fixture seeds; authored StudioData API calls remain compatible.

## Import, export, and migration seams

ZIP import first validates paths, sizes, and supported file types into a temporary workspace. A studio export must also have a supported manifest and required entries; a plain project ZIP may omit studio metadata but must contain an `index.html` entry point. Import swaps the active workspace only after validation succeeds. ZIP v3 puts authored files in `project/`, fixture bytes and versioned definition/handle sidecars in `studio/fixtures/`, and all transcripts and tool events in Studio metadata. The generated `project/fixture-seed.js` keeps the standalone project runnable. Import migrates v1 project fixtures and v2 Studio fixtures into typed datasets; unknown newer versions fail with a clear message.

## Package candidates and evidence

| Need | Candidate | Note |
| --- | --- | --- |
| Editor/diff | [Monaco](https://microsoft.github.io/monaco-editor/) | Editor models must be synchronized with workspace revisions. |
| Agent loop/model calls | [Pi agent core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md) + [Pi AI](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) | Browser tool and auth adapter are our code. |
| CSV | [Papa Parse](https://github.com/mholt/PapaParse) | Browser parsing and serialization. |
| XLSX | [ExcelJS](https://github.com/exceljs/exceljs) | Implemented codec; typed round trips and browser conversion are verified. Workbook features outside the declared model are rejected. |
| ZIP | [zip.js](https://github.com/gildas-lormeau/zip.js/) | Validate streaming and large-file behavior in the target browser. |

WebContainers remain a later option if the product expands to npm-based projects. They require cross-origin isolation and a commercial license for commercial production use; those costs are unnecessary for the proposed static-site scope. See [vendor quickstart](https://webcontainers.io/guides/quickstart) and [commercial terms](https://webcontainers.io/enterprise).

## Generic binding attachment points

`src/datasets.ts` owns the portable definition, types, defaults, validation, schema growth, row operations and semantic comparison. `src/fixtures.ts` owns CSV/XLSX codecs and sidecar/seed encoding. `src/datasetService.ts` applies those operations to a caller-owned transactional writer. `StudioRuntime.datasets`, table saves/imports and preview requests connect it to Workspace; `createTools` connects it to Stage; `applyAgentChange` connects complete groups to automatic commits. `TableDocuments` retains schema-aware drafts and baselines. ZIP v3 carries all accepted dataset contracts.

A later PowerHarness module should map accepted provider evidence to stable field IDs/provenance, set `schemaPolicy: 'fixed'` where appropriate and inject `DatasetPolicy` through StudioRuntime/agent turn context. Its evidence inspection, mappings and compilation remain separate modules. It should use the existing transaction, mutation, review and codec pipelines. Pi includes no .msapp parser, SharePoint conventions, YAML compiler or Power Fx runtime; PowerApp was used only as read-only behavioral evidence for permissions, schema comparison and physical-row targeting.
