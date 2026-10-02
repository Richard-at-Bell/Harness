# Implementation status

Status: **working first milestone** · 2026-10-02

The [specification index](README.md) describes the intended product. This page records what the current code actually does.

| Area | Working now | Next seam |
| --- | --- | --- |
| Project workspace | Separate OPFS project and Studio fixture stores; IndexedDB multiple chats; ZIP import/export | Atomic write journal, multiple projects, checkpoints |
| Editor | Monaco HTML/CSS/JavaScript editing and diff review | Binary asset browser, rename/delete UI, accessibility pass |
| Agent | Pi agent core and Pi AI through OpenRouter; file and table tools with a persistent Review changes switch; immediate application when review is off; compact picker with six model choices and live input/output prices | Cancellation, undo checkpoints, tool payload limits, richer trace and broader model catalog discovery |
| Preview | Sandboxed iframe with inline project CSS/JS, local images up to 2 MB, and a table bridge | Other asset types, console capture, broader multipage support |
| Data | CSV/XLSX table editor, import, conversion, seeded row generation, preview mutations; new scalar row fields automatically append fixture columns | Explicit column rename/delete/type editor, large table handling |
| Export | Static project plus fixture seed; Studio fixture files, all chats and tool events; v2 manifest with hashes and v1 import; explicit ZIP preparation and download dialog | Checkpoints and full agent trace in ZIP |

The reference to-do app works as a static project. In the studio, its table adapter writes back to a Studio fixture in OPFS. In an exported static site, it starts from the generated fixture seed and saves changes to that browser's local storage. Its CSV download button lets a user take modified rows out of the standalone site.

The current build is intentionally a desktop oriented prototype. Monaco and Pi make the first-load bundle large; the build completes with a chunk-size warning. The next performance step is to split the editor and agent code into lazy chunks.

The review switch was verified through two live agent turns in the browser: review off changed the preview immediately without an acceptance step; review on kept the previous preview until acceptance. A full reload retained the switch setting and saved workspace. The 35 automated tests and production build pass, including checks for automatic file/fixture writes, conflicting edits, and failed save rollback in the tool stage.

The studio now uses scoped Zustand subscriptions for accepted workspace snapshots and chat/review state. The workspace service serializes complete operations, publishes after storage success, and protects byte ownership. Agent callbacks capture turn/chat/workspace identity; import and reset invalidate earlier work. Feature components own their local drafts and resources. The [ownership map](state-ownership.md) records the implemented boundaries and remaining persistence limits.

Browser checks for this refactor verified preview insertion, observation in Studio data, fixture drafts surviving tab changes, fixture saves reflected in preview, prompt retention while hiding the agent, prompt clearing on a new chat, ZIP preparation, and workspace/chat persistence after a full reload. Controlled workflow runners cover agent streaming/completion races and review transitions; no new live provider request was made.
