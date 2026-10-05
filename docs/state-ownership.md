# State ownership and persistence boundaries

Updated 2026-10-05. This describes implemented behavior, supplementing the product specification. The starting review fixes were inspected and checkpointed with 41 passing tests before this hardening work.

## Owners and subscriptions

The application uses scoped vanilla Zustand stores through `StudioContext`. Stores publish reactive projections; service operations own persistence, validation and asynchronous work. `main.tsx` opens and validates committed storage before rendering controls or starting session persistence. `configureMonaco.ts` configures the editor and workers for both the application and isolated browser tests.

| State or resource | Owner / writers | Observers and lifetime |
| --- | --- | --- |
| Accepted project and fixture bytes | `Workspace`, through queued operations and the storage commit contract | File lists select paths; editor/breadcrumb select one file; preview selects project bytes and observes fixture commits. Accepted bytes persist in IndexedDB. ZIP contracts retain separate `project/` and `studio/fixtures/` namespaces. |
| Durable revision and workspace identity | `IndexedWorkspaceStorage`; Workspace publishes completed commits | Revision advances once per changed operation or deliberate replacement. Revision survives reload and is checked across tabs. Identity changes on deliberate replacement; equal contents still constitute replacement. |
| Replacement phase and file/table/tab selection | `StudioRuntime` lifecycle store | App observes selection and phase; generation identifies the active editing/preview session. Navigation reconciles at activation. Ordinary navigation is not persisted; the activation's default selection is persisted. |
| File buffer / path and save request | `EditorDocuments`, one editing session per generation | Selected buffer drives Monaco immediately. Baseline, accepted observation, newest request and conflict are distinct. Retained in memory across file/view/data navigation and failed replacement; released after successful replacement or teardown. |
| Monaco model and view state | `EditorDocuments`; FileEditor attaches the view | Unique session-qualified model URIs preserve undo. The session owns cursor/scroll state, avoiding the wrapper's global view-state cache. Models are retained during navigation, detached/disposed at session teardown, and view states are cleared. |
| Parsed table draft / table ID | `TableDocuments`, one editing session per generation | Grid observes one table; dirty rows survive navigation and external fixture changes. Parse tokens and session epochs reject obsolete results. Drafts are memory only; save/convert is explicit. |
| Chat records, active chat, review preference and turn/review transitions | `sessionStore.ts` | Transcript and activity select separate arrays; untouched chat/line/tool references are retained. SavedSession v2 format and legacy single-chat migration remain. |
| Session save scheduling | `sessionPersistence.ts`, attached after hydration | Debounced 350 ms and serialized. Captured identity prevents an old queued record from overwriting replacement metadata. Stop flushes and unsubscribes. |
| Agent turn, controller and working Stage | `agentTurns.ts` | Turn captures chat/answer/model/review/generation. Detached Stage owns working bytes; callbacks check turn ownership and generation. Controller is aborted at replacement/close. |
| Pending review | Session transition at turn completion | Detached stage/baseline snapshot. Acceptance locks discard/repeated acceptance, checks the base revision, and clears review after durable commit. Failure retains the review for retry. |
| Preview document, capability and build token | `PreviewPanel` | Only latest build publishes. Requests capture iframe source, generation and capability, recheck identity in queued work, and reply only to the originating iframe. Code changes rebuild; fixtures notify without rebuilding. |
| Prompt, API key, dialogs and export URL | Feature components / App | Key remains in tab memory and is excluded from stores, storage and ZIP. Hiding panels preserves prompt and editing sessions. Blob URLs, listeners and expiry timers retain explicit cleanup. |

Published maps are typed read-only. Working snapshots copy byte arrays; published bytes are detached from authoritative service bytes, so a consumer cannot corrupt persistence by mutating a published typed array. JavaScript cannot freeze nonempty typed arrays. Unchanged published file references and maps are retained. Operation staging shares private immutable accepted arrays until a path changes; writers and outward-facing snapshots never expose those arrays for mutation.

Consumers select an existing array, map, primitive or byte reference. `FileList` and `DataList` use `useShallow` for computed primitive arrays. Component memo boundaries prevent unrelated parent renders from bypassing narrow subscriptions. Diff parsing/rendering and preview builds retain cancellation tokens. No whole-store persistence middleware is used. These choices follow Zustand's [createStore](https://zustand.docs.pmnd.rs/reference/apis/create-store), [useStore](https://zustand.docs.pmnd.rs/reference/hooks/use-store) and [useShallow](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow) APIs.

## Replacement lifecycle

Import and reset share a named replacement operation:

1. **Preparing:** ZIP parsing/validation or template preparation. Existing edits, preview mutations and agent work may continue. Duplicate replacement requests reject.
2. **Committing:** new runtime operations and agent starts reject at the service boundary with recoverable feedback. Previously admitted operations finish before replacement. Generation, accepted contents, session and selection still describe the previous activation while storage is pending.
3. **Activation:** one storage transaction commits contents, durable identity and replacement session/selection metadata. Workspace publishes new accepted contents before a new generation is observable. Runtime cancels the previous turn, replaces the session and selection, advances generation, then returns to idle. Generation-keyed editing sessions dispose old drafts/models; preview capabilities become obsolete.
4. **Failed:** preparation or commit error is observable. Accepted contents/revision, generation, session, pending review, selection and recoverable drafts remain intact. Ordinary operations and replacement retry are permitted.

The gate is enforced by `StudioRuntime.transact`, not by buttons alone. Async operations check their captured generation inside the queue. A stale editor/preview/agent cannot adopt replacement identity and write into old contents. Closing invalidates callbacks and aborts the agent; storage activation already underway may complete durably and is available on the next open. It cannot be undone by unmounting a panel.

## Draft acknowledgement and conflicts

File editing remains immediately visible while automatic saves queue per path. Each request captures text and an editing-session epoch. The trusted baseline advances only through owned save acknowledgement or explicit reload. An older successful save can advance a baseline but cannot clear newer text; an older failed request cannot replace a newer buffer. Storage failure exposes retry without losing text.

File saves compare expected accepted bytes inside the workspace operation queue, separately from the whole-workspace durable revision CAS. External changes to a dirty file retain its text and enter conflict. Conflict stops automatic saves and retry. The user can copy the draft, then explicitly reload accepted contents; queued saves from the discarded draft are invalidated. Clean files adopt new accepted contents normally.

Tables retain parsed schema/rows by table identity. External preview/agent writes, conversion or removal retain dirty rows and enter conflict. Save results acknowledge their exact committed bytes/path. Edits made while saving remain dirty after acknowledgement. Dirty rows do not become accepted merely by changing selection. Copy exports the parsed representation as JSON to the clipboard, including columns and rows; reload explicitly discards it. No automatic merge or stale overwrite occurs.

A durable cross-tab revision conflict also preserves dirty input. The feedback and recovery action instruct the user to copy drafts and reopen the studio; a stale tab does not offer a local reload as though it could fetch the newer activation. Tabs do not synchronize their live projections automatically. Reloading the page still loses unpersisted drafts; recovery controls must be used first.

## Durable atomicity and scope

`workspaceStorage.ts` defines a commit with an **expected durable revision**, an explicit set of project/fixture **writes and removals**, and optional **replacement metadata**. `Workspace.transaction` stages detached maps and serializes the full read/parse/modify/serialize operation in this runtime. This queue provides local ordering; atomicity comes from the IndexedDB transaction below it.

The authoritative database is `browser-project-studio-commits-v1`, schema version 1:

- `blobs`: content-addressed Uint8Array records keyed by SHA-256.
- `manifests`: versioned complete project/fixture path-to-hash maps plus identity and activation session/selection metadata.
- `meta`: active revision/identity pointer and current chat/review metadata.

Preparation copies and hashes changed bytes without writing durable preparation records. A read/write transaction spanning all three stores checks the active revision, writes changed byte records, creates the next manifest and activates its pointer and session metadata. It requests `durability: strict` and reports success only after transaction completion. Throwing after an individual record write, before activation or after pointer writes aborts the whole transaction. The previously active revision remains complete and unchanged. This follows the [IndexedDB transaction lifecycle](https://www.w3.org/TR/IndexedDB/#transaction-lifecycle) and [durability option](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/durability); store publication alone supplies no durability guarantee.

The guarantee applies to review acceptance, import, reset, fixture import/conversion and each ordinary workspace operation. Successful automatic agent mutations remain individually committed if a later tool/provider request fails. An entire automatic turn is intentionally not atomic. Ordinary chat streaming/renaming and review preference changes are debounced metadata saves, outside the content commit guarantee. Replacement chats and identity activate atomically with replacement contents. Same-identity chat updates across tabs remain last-writer-wins; there is no collaborative transcript merge.

Cross-tab accepted writes compare the durable revision inside a shared read/write transaction. Two connections using the same revision cannot both commit. A stale tab rejects instead of overwriting another tab's accepted work. The in-memory queue makes no cross-tab isolation claim.

## Migration, recovery and retention

First open with no active commit reads legacy OPFS project and fixture roots and legacy IndexedDB chat/review records. Fixtures formerly nested under the project root migrate into the fixture manifest namespace. Empty legacy project storage receives the existing template. One atomic initialization commits bytes and normalized SavedSession v2 metadata. Competing initializers use the same durable revision CAS and load the winner.

Legacy roots and metadata are left untouched as backups. After activation, the new database is authoritative; later opens never merge stale legacy bytes back in. ZIP v1/v2 import, export paths, CSV/XLSX formats and generated runtime support contracts remain unchanged. Migration failure leaves legacy data and the previous activation intact. Leaving old backups consumes storage and avoids destructive cleanup during migration.

Startup captures active pointer, manifests, blobs and session metadata in one read transaction. It validates paths, session structure and every referenced SHA-256 digest before publication. Missing/corrupt active data falls back to a retained complete manifest, activates it through a revision CAS, and reports recovery. Recovery advances revision rather than resurrecting an old revision number. Damaged newer manifests are removed only after successful recovery. Invalid newer chat metadata falls back to the activation's session snapshot; recent chat text may be lost. If no complete revision remains, startup fails closed with an actionable error and preserves records instead of silently replacing the project with defaults.

Cleanup retains the active and previous manifest and their referenced bytes. It removes other manifests and orphan blobs in another serialized IndexedDB transaction. Aborted preparation/commit creates no durable orphan records. Startup and successful commits retry cleanup; cleanup failure can delay reclamation but cannot turn a successful activation into a failed save.

## Storage design evaluation

OPFS immutable blobs plus an IndexedDB active pointer would retain stream-friendly large assets, but require separate durable preparation, orphan coordination and recovery across two storage domains. For this small studio, transactional IndexedDB byte records and manifests keep bytes and activation metadata within one database commit.

`tests/browser/measure.mjs` uses a fresh browser context and five 20 MB incompressible assets, matching the 100 MB decompressed ZIP ceiling. Local Chromium observations were 121–449 ms for initialization, 89–170 ms for load/hash verification, 27 ms for Workspace construction and 6 ms for an ordinary small Workspace edit including publication. Estimated stored usage was about 100.3 MB. The measured incremental edit does not copy unchanged large accepted assets. These are development-machine observations, not latency or quota guarantees. Large imports and startup still hold complete snapshots in memory, and retaining two revisions plus legacy backups increases storage usage.

## Verification and remaining boundaries

Commands and isolation details are in [tests/browser/README.md](../tests/browser/README.md). Verification on 2026-10-05:

- **67 unit tests:** original editor/agent/fixture/preview/ZIP regressions plus replacement phases, coherent generation publication, stale saves, dirty conflicts, in-flight acknowledgement, failed review/conversion retry, atomic abort boundaries, competing connections, interrupted preparation, migration, missing/corrupt bytes, invalid metadata and retention/cleanup.
- **8 automated Chromium scenarios:** actual typing, file/view/data navigation, cursor/undo preservation, failed save/retry/reload durability, controlled agent conflict recovery, table conflict recovery, failed/successful replacement and model disposal, real OPFS migration, real second-tab CAS conflict, and conversion failure/retry. Browser contexts use isolated storage and no live provider credentials. The cursor/undo/disposal scenario also passed three consecutive repetitions after resource ownership changes.
- TypeScript and the production build pass. Existing large-chunk warnings from Monaco/Pi/ExcelJS remain. Test controls are confined to a separate test entry and are not in the production build.

Atomic local persistence remains subject to browser quota, origin eviction/deletion, storage device failure and implementation durability behavior. Fault injection verifies database abort behavior, not physical power-loss or disk corruption guarantees. Two retained manifests are bounded recovery, not user-facing checkpoint history. Drafts/undo are memory only; abrupt page/process termination loses unsaved drafts and up to the debounce interval of ordinary chat changes. Tabs reject stale accepted writes but do not automatically reconcile live state or merge chat metadata. Real provider networking still needs a user-supplied key; controlled runners verify agent coordination without sending credentials.

## Architectural work before expanding workflows

The formerly proposed replacement, conflict and durable commit boundaries are implemented above. Keep accepted data, editing sessions, model/view resources, preview capabilities and storage transactions as separate owners when extending workflows. Generated `data-store.js` ownership is outside this persistence change and remains a separate Studio runtime concern. Future collaboration, persistent draft recovery or user-facing checkpoint history must define their own activation and recovery semantics rather than reusing the queue as a durability claim.
