# State ownership and subscriptions

Implemented 2026-10-02. This is the ownership map for the running application, supplementing the product specification.

## The boundaries chosen

The application uses scoped vanilla Zustand stores accessed through `StudioContext`. Each mounted studio owns its runtime; opening is cached across React effect replays. `main.tsx` configures Monaco, opens storage and hydrates the session, then attaches persistence. `App.tsx` composes features and owns navigation and dialogs. It does not subscribe to streamed chat text or whole workspace snapshots.

`Workspace` remains the authoritative owner of accepted project and fixture bytes. Its Zustand store is a read-only projection, with no public `setState`. `sessionStore.ts` owns chat records, active chat identity, the review preference and coherent turn/review transitions. `studioRuntime.ts` coordinates application operations. `agentTurns.ts` owns the asynchronous agent workflow; `sessionPersistence.ts` owns persistence scheduling. A small lifecycle store publishes workspace generation changes so local drafts and previews can invalidate their context.

This avoids independently writable accepted data in a service and store. Storage and orchestration are not store setters, and component drafts do not become accepted data until an operation commits them.

## Investigation and decisions

| Construct / identity | Owner and writers | Observers / meaningful change | Lifetime and persistence |
| --- | --- | --- | --- |
| Accepted project file / validated path | Workspace, through serialized operations | File list observes sorted paths; editor observes bytes for one path; breadcrumb observes that file's size; preview observes accepted code/assets. A content-equal write is a no-op. | Workspace lifetime; OPFS project root and existing ZIP contract |
| Accepted fixture / path and table ID | Workspace; runtime coordinates table saves, conversion, import and preview mutations; agent changes use the same queue | Selected fixture parser observes path/bytes; fixture list observes IDs/formats; preview bridge observes changed fixture references. CSV/XLSX path may change while table identity stays the same. | Workspace lifetime; separate OPFS fixture root and ZIP `studio/fixtures` |
| Workspace revision | Workspace; increments for successful changed paths | Review acceptance checks its captured base revision inside the operation queue | Operational; not a persisted transaction ID |
| Workspace generation | Runtime; advances on import/reset and close | Agent callbacks, queued operations, drafts and preview requests reject an old generation | Transient; replacement remains meaningful even if bytes are equal |
| Chat / chat ID | Session actions, hydrated/imported records | Switcher observes chat records; transcript selects active chat lines; activity selects active chat tools; composer selects model, mode and locks | Persisted in unchanged session-v2 format; old single-chat migration retained |
| Agent turn / turn ID, chat ID, answer ID | Agent workflow and session transitions | Streaming text updates only the captured answer. Tool-call IDs replace entries in the captured chat's activity log. Other chat and line references are retained. | Transient; captures model, review mode, generation and history at start |
| Agent working Stage | One agent turn | Tools read and mutate working files; automatic mode refreshes before tools and compares affected bytes at commit | Service-owned resource outside Zustand; isolated byte copies |
| Pending review | Session transition at turn completion | Review card selects immutable published paths; diff asynchronously renders selected baseline/current bytes; acceptance checks base revision | Transient detached snapshot; model/chat/mode switching stays locked; discarded on replacement |
| Table rows / parsed draft | DataPanel | Grid and generator; selected fixture changes reload that draft. Unrelated fixture changes preserve it. A delayed parse cannot overwrite a new selection. | Local; remains mounted across tab switches; save checks captured bytes/generation |
| Prompt and API key | AgentPane and App respectively | Composer/settings; prompt clears on chat or workspace context change | Memory only; hiding the agent preserves the prompt; key is excluded from stores, persistence and exports |
| View, file/table selection, dialogs and new-item fields | App | Presentational components through props | Local; no new persistence behavior |
| Preview document / build token | PreviewPanel | Iframe; only latest completed build publishes. Each build has its own capability token and captured generation. | Local asynchronous artifact; code/assets/reload rebuild; fixture commits notify without rebuilding |
| Export Blob URL | App | Download dialog | Local resource revoked on replacement/close/unmount; export captures detached accepted data and session at the queue boundary |
| Activity filters, model catalog, Monaco handles | Existing feature components | Their component UI | Local state or resources with existing cleanup; live prices are not application facts |
| Notice | Session's transient feedback field, controlled by runtime | Notice component only | Not persisted; runtime owns and clears its expiry timer |

## Publication and concurrency invariants

- Workspace captures incoming byte arrays before queuing; working snapshots copy nested byte arrays. Stage baselines and working maps are also detached. Published maps are typed read-only; their typed-array values must be treated as read-only. JavaScript cannot freeze nonempty typed arrays. Published bytes are separate from the service's bytes, so accidental consumer mutation cannot corrupt accepted storage.
- Publication follows successful persistence. Unchanged published byte references and whole unchanged maps are retained. A failed write does not publish its attempted bytes or poison later operations.
- The workspace queue protects the entire read/parse/modify/serialize/write operation. Its callback receives an unqueued writer; calling the public queued methods from inside a transaction would deadlock. The runtime routes all application operations through this boundary.
- Preview table mutations, fixture drafts, conversion/import, automatic agent comparisons, review revision checks, reset/import and export snapshots share that queue. Conversion writes the destination before deleting the source and publishes the resulting fixture map once.
- Editor typing stays immediately visible as a local draft while disk writes complete in order. The store only contains accepted data. Fixture saves compare their captured baseline inside the queue, preventing a preview or agent edit from being silently overwritten by an older draft.
- Review acceptance has an explicit accepting transition. Discard and repeated acceptance cannot compete with an in-flight disk commit; failures retain the review and restore its controls.
- Successful automatic writes remain applied after a later agent failure. Review-mode failures retain completed staged changes for review. A published review is detached from the agent's mutable Stage.
- Import/reset invalidate the old turn and preview generation at the serialized replacement boundary. Streaming callbacks check turn ownership; asynchronous tools and queued writes check generation. Old callbacks cannot update an imported chat even if it reuses a chat ID.
- Preview requests capture their source iframe and build identity. Queued requests recheck that identity before reading, serializing and writing; replies never go to a replacement iframe. List requests also run through the operation queue.

## Subscriptions and derived views

Consumers select a primitive, existing array, map, entity, or file byte reference where possible. `FileList` and `DataList` use `useShallow` because their selectors construct sorted primitive arrays. The selected fixture path/bytes tuple also needs shallow result stability. Transcript and tool activity select separate arrays, so text deltas do not change tool subscriptions, and workspace changes do not rerender chat consumers through App.

File text, file paths, table IDs/formats, review paths, model names and UI locks derive from their authoritative source. Parsed XLSX/CSV drafts, rendered spreadsheet diffs and preview HTML are retained asynchronous artifacts with explicit selection/build cancellation. No duplicate content hash or file-text store is maintained.

Component memo boundaries also keep parent renders from bypassing those subscriptions: composer typing does not rerender transcript/activity, text deltas do not rerender activity/review, and the breadcrumb owns its file-size subscription. The diff uses a portal so hiding the agent does not hide a pending full-screen review.

These choices follow the official Zustand [createStore API](https://zustand.docs.pmnd.rs/reference/apis/create-store), [useStore API](https://zustand.docs.pmnd.rs/reference/hooks/use-store), and [useShallow guidance](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow): immutable publication, narrow selections, and stable outputs for computed array/tuple selectors. Whole-store persistence middleware is deliberately unused.

## Persistence and cleanup

Hydration loads OPFS, session records and review preference before rendering actionable controls or attaching persistence. It never saves defaults over loaded records. Session persistence subscribes only to record/active-chat/preference changes, debounces them, serializes captured saves, and flushes pending work before unsubscribing on runtime cleanup. Workspace storage formats, fixture migration, session migration, ZIP v1/v2 contracts and credential handling remain unchanged.

Runtime cleanup invalidates work, aborts the agent, removes persistence subscriptions and clears the notice timer. The agent removes its stream subscription and abort listener in `finally`. PreviewPanel owns the message listener, fixture subscription and build cancellation; ChatSwitcher and DiffReview retain their component-level listener/model disposal. Table/diff parsing checks whether its effect is still current. Blob URLs are revoked by App.

## Verification and limits

Focused tests exercise detached bytes and stable references; publication after persistence; operation serialization; revision checks after earlier queued writes; partial-success publication and queue recovery; captured answer/chat targeting; reused imported chat IDs; post-hydration ordered persistence and cleanup; delayed agent completion after replacement; review conflict/failure/acceptance; automatic edits surviving a later failure; preview mutation versus stale fixture saves; old preview requests; and coherent CSV/XLSX conversion. Existing agent, fixture, preview and ZIP migration/round-trip tests remain in the suite. The final suite contains 35 passing tests; TypeScript and the production build pass. Browser verification confirmed preview insertion, fixture observation and saving, local draft lifetimes, ZIP preparation and persisted workspace/chat data after reload.

The OPFS layer still has no multi-file atomic journal. If a batch fails after some paths were saved, those successful paths remain accepted and are published together when the operation ends; the error is surfaced. A reload reconstructs accepted bytes from disk. Multiple browser tabs are not coordinated, and sudden page/process termination can interrupt writes or a debounced IndexedDB save. Existing bundle-size costs from Monaco/Pi remain. Real provider streaming must be exercised with a user-supplied key; workflow tests use controlled runners to verify failure and delayed-callback paths without a network request.
