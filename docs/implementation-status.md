# Implementation status

Status: **working first milestone** · 2026-10-05

The [specification index](README.md) describes the intended product. This page records what the current code actually does.

| Area | Working now | Next seam |
| --- | --- | --- |
| Project workspace | Atomic IndexedDB revisions for project/fixtures and replacement chats; legacy migration; ZIP import/export | Multiple projects, user-facing checkpoints |
| Editor | Monaco editing/diff review; recoverable conflicts and retained undo/view state | Binary asset browser, rename/delete UI, accessibility pass |
| Agent | Pi agent core and Pi AI through OpenRouter; file and table tools, including CSV/XLSX table creation, with a persistent Review changes switch; immediate application when review is off; compact picker with six model choices and live input/output prices | Cancellation, undo checkpoints, tool payload limits, richer trace and broader model catalog discovery |
| Preview | Sandboxed iframe with inline project CSS/JS, local images up to 2 MB, and a table bridge | Other asset types, console capture, broader multipage support |
| Data | CSV/XLSX table editor, import, conversion, seeded row generation, preview mutations; retained dirty drafts and explicit conflict recovery; new scalar row fields automatically append fixture columns | Explicit column rename/delete/type editor, large table handling |
| Export | Static project plus fixture seed; Studio fixture files, all chats and tool events; v2 manifest with hashes and v1 import; explicit ZIP preparation and download dialog | Checkpoints and full agent trace in ZIP |

The reference to-do app works as a static project. In the studio, its table adapter writes back to an accepted Studio fixture through the atomic workspace commit. In an exported static site, it starts from the generated fixture seed and saves changes to that browser's local storage. Its CSV download button lets a user take modified rows out of the standalone site.

The current build is intentionally a desktop oriented prototype. Monaco and Pi make the first-load bundle large; the build completes with a chunk-size warning. The next performance step is to split the editor and agent code into lazy chunks.

The review switch was verified through two live agent turns in the browser: review off changed the preview immediately without an acceptance step; review on kept the previous preview until acceptance. A full reload retained the switch setting and saved workspace. The current 75 unit tests and production build pass, including atomic commit failure/retry, migration/recovery, cross-tab conflicts, fixture creation, preview fragment navigation, and editing resource teardown. Eight isolated Chromium scenarios passed during the earlier architectural review; they were not rerun for the food diary conversion.

The studio now uses scoped Zustand subscriptions for accepted workspace snapshots and chat/review state. The workspace service serializes complete operations, publishes after storage success, and protects byte ownership. Agent callbacks capture turn/chat/workspace identity; import and reset invalidate earlier work. Feature components own their local drafts and resources. The [ownership map](state-ownership.md) records the implemented boundaries and remaining persistence limits.

Browser checks for this refactor verified preview insertion, observation in Studio data, fixture drafts surviving tab changes, fixture saves reflected in preview, prompt retention while hiding the agent, prompt clearing on a new chat, ZIP preparation, and workspace/chat persistence after a full reload. Controlled workflow runners cover agent streaming/completion races and review transitions; no new live provider request was made.

A live provider review on 2026-10-05 subsequently exercised two GPT-6 Luna turns through the Studio UI, with 23 successful tool calls. Reviewed file changes and automatic file/CSV fixture changes passed preview, task mutation, original-row preservation, narrow-layout, activity, and full-reload checks. The completed sample adds search, task filters, sunflower accents, and task priorities. ZIP preparation succeeded, but a completed download remains unverified in the in-app browser. See the [browser workflow review](browser-workflow-review.md) for the observed results and scope.

Architectural hardening includes explicit replacement phases, retained file/table conflicts, and isolated browser regressions. See [state ownership](state-ownership.md) for implemented guarantees and remaining limitations.

A subsequent live conversion used three Studio chat turns to turn the to-do project into Plate, a daily food diary. Its 75 tool calls include three initial errors that exposed missing fixture creation. The harness now supplies `create_table`, explains the sandbox’s native-dialog limitation, and keeps fragment links within the preview. The agent repaired the generated app through two follow-up prompts. Browser checks verified date totals, meal add/edit/delete, goal writes, reload persistence, original task preservation, and a narrow food form. The current browser project and fictional sample data are described in the [food diary review](browser-workflow-review.md#food-diary-conversion-on-october-5-2026).
