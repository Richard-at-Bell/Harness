# Typed datasets and ZIP format

Implemented 2026-10-07. Related decisions: [D-006](decisions.md#d-006-what-table-writes-mean-after-export), [D-007](decisions.md#d-007-fixture-formats). The ownership guarantees are described in [state ownership](state-ownership.md).

## Definition and identity

`src/datasets.ts` defines `DatasetDefinition`, `Field`, `Dataset`, `Mutation` and `DatasetPolicy`. A definition contains a stable Studio ID, a case-preserving display name, ordered fields with stable IDs and case-preserving names, a schema revision, a blank policy, a `grow` or `fixed` schema policy, and generic provenance (`source`, optional `reference` and `revision`). Fields declare `text`, `number`, `boolean` or `datetime`, nullability, optional defaults, permissions and constraints. Constraints support numeric bounds/integer, text length/pattern and an allowed-value list.

A dataset has ordered typed rows, a data revision and opaque Studio row handles. Handles are persisted beside the rows and never become CSV/XLSX business columns. An optional `rowIdentity` references a declared field ID; if present, its values must be nonblank and unique. Datasets without a business identity support duplicate codes and targeted edits by handle. New datasets use UUID storage stems independently of display names. Legacy stems and names retain their original casing.

The authoritative fixture group is:

```text
fixtures/<storage-stem>.csv       # alternatively .xlsx
fixtures/<storage-stem>.dataset.json
```

The JSON sidecar contract is `{version: 1, definition, revision, handles}`. It belongs to the existing Workspace fixture map and IndexedDB manifest, not another persistence system. Its definition is validated against the exact ordered header and row count. Orphan metadata, duplicate dataset identities/names, mismatched headers and invalid values fail validation.

## Shared operations

`DatasetService` runs on a `DatasetWriter` inside the Workspace transaction queue or an isolated agent Stage. `StudioRuntime.datasets` exposes `create`, `read`, `page` and `mutate`. `saveTable` and `importTable` use the same service. Mutation variants are `insert`, `update`, `remove`, explicit `replace`, and `addFields`. Targeted operations require an expected dataset revision and a Studio handle. `addFields` declares new field contracts and optional values for selected handles in one operation. Existing fields, order, handles and older rows survive additive changes.

In a `grow` dataset, previously undeclared scalar fields in a mutation create an explicit definition revision alongside their values. The type comes from native values, never from guessing whether text looks numeric or Boolean. Added fields are nullable; missing values in older rows become null. All-null additions default to nullable text; use `addFields` to choose another type or constraints. Mixed native types, nested values and nonfinite numbers are rejected. A `fixed` dataset rejects added fields. Declared fields enforce their types, constraints and read-only permissions across editor saves, tools, preview mutations and imports. Creation can seed read-only fields; later writes cannot change them.

`DatasetPolicy.validate(before, after)` is the narrow additional validation boundary. StudioRuntime accepts it and passes it to both preview/user services and agent callbacks. A later binding module can enforce accepted external contracts without replacing storage, review or codecs. No provider-specific conventions are built in.

The serializer accepts a declared definition and rejects undeclared fields. Legacy `Table` inputs remain a compatibility boundary for older callers/tests; legacy migration supplies a definition before normal operations.

## CSV and XLSX codecs

Both codecs use the same schema and normalized rows. CSV uses UTF-8, comma delimiters, quoted fields and exact ordered headers. XLSX uses one data worksheet with native numeric/Boolean cells and text for declared datetime values. Datetimes require a timezone, reject invalid calendar values and precision beyond milliseconds, and normalize to UTC ISO text. Formula/object/rich-text cells, additional worksheets and extra cells are rejected with an explicit conversion error; workbook formatting is not retained.

The `escaped-null-v1` policy distinguishes blank text from null:

| Declared field | Blank CSV / blank XLSX cell | Null representation |
| --- | --- | --- |
| Text | Empty string, including nonnullable text | `\N` when nullable |
| Number / Boolean / datetime | Null if nullable; error otherwise | Blank, or explicit `\N` |

Literal text beginning with a backslash is escaped with an additional backslash. Text beginning with `=`, `+`, `-`, `@`, tab or carriage return is also prefixed with a backslash, preventing spreadsheet formula interpretation while preserving the original text on decoding. A literal `\N` therefore differs from null. Text `0007` and `TRUE` remain text. Declared numbers and Booleans decode only supported number syntax and lowercase `true`/`false`; malformed or lossy values fail before writes.

A standalone CSV/XLSX file lacks its Studio definition. New CSV imports therefore declare text fields; XLSX imports preserve homogeneous native scalar types, with ambiguous mixed columns rejected. Explicit-schema imports and imports into existing named datasets parse raw headers/cells and decode directly against the declared contract, without legacy name-based inference. A typed dataset named `todos` can therefore declare `completed` as text and preserve `TRUE`/`FALSE`. Existing imports preserve the definition/ID, field identities/order/casing and constraints. Such an import deliberately replaces all rows and assigns new handles. ZIP is the complete portable contract, including field types, constraints and row identity.

## Legacy compatibility and generation

Legacy datasets receive deterministic `legacy:<name>` identities and field/row IDs, then persist their sidecars on workspace open, reset or ZIP migration. Generic CSV values remain strings. Only the reference `todos` contract declares `completed` Boolean, `created_at` datetime and its UUID/time/false defaults. A legacy unique nonblank `id` field becomes an optional declared identity; duplicate codes do not become identities. Existing bytes remain unchanged when attaching metadata is already lossless; values needing escapes are reencoded atomically with their metadata. Migration is repeatable and leaves OPFS backups untouched.

Generation uses declared types and a seed, with a fixed reference date, rather than column-name assumptions. Generated rows remain a draft until saved; normal validation also applies to generated values. Persisted generation recipes and column rename/delete/type-edit UI remain future work. The grid edits typed values, exposes an explicit null action, disables read-only cells and displays at most 100 rows per page.

## Agent and preview contracts

`read_table` returns a bounded page: definition, revision, columns, total, offset, nextOffset, rows and handles. Defaults are offset 0 and limit 100; limits are 1–1000, with a 200,000-character budget for the definition and row/handle content. A single oversized row fails explicitly. `insert_row`, `update_row` and `remove_row` require a revision; targeted tools preserve unread rows. `write_table` intentionally requires `replaceAll: true` and a revision because it replaces the complete row set. `create_table` accepts typed fields, up to 1000 initial rows and optional format/policy/identity. Legacy `columns` shorthand infers native value types and declares an `id` identity for existing authored-app compatibility. Data service datasets support at most 100,000 rows; bounded reads still parse the complete local fixture in memory.

Review stages the complete changed fixture group. Acceptance writes schema and row bytes in one durable transaction, or retains the original acceptance and review on failure. Discard writes nothing. Automatic agent changes save one complete group per tool; a failed tool restores its Stage. A successful earlier tool remains accepted after a later failure.

Existing authored `StudioData.list/insert/update/remove/subscribe` calls remain supported, including declared business IDs. The current template adds `page(table, {offset, limit})`; update/remove can use handles and an optional `{revision}` argument, and insert accepts optional revision options. The adapter remembers read revisions. Legacy bridge messages still return their original values; protocol 2 adds a `{value, revision}` response envelope. Source-window, token, workspace generation and current-preview guards still apply before and after asynchronous parsing/encoding. Fixture commits notify display names without rebuilding project code.

`fixture-seed.js` contains typed initial rows, definitions/handles and the same self-contained validation kernel used by Studio. In an exported static site, the adapter uses browser local storage, migrates old local row arrays, validates changes and can download updated CSV. It cannot rewrite packaged files. Existing authored adapter files are preserved; the enhanced adapter is supplied by new/reset templates and is available to authored projects explicitly.

## ZIP contract and integrity

Exports use manifest version **3** with `datasetMetadataVersion: 1`. Project source stays under `project/`; fixture bytes and sidecars stay under `studio/fixtures/`. Chats and tool events retain the v2 layout. Generated `project/fixture-seed.js` is derived output. Model credentials and internal provider conversation context remain excluded.

The manifest lists both fixture files and sidecars and SHA-256 hashes. Import checks exact fixture membership, required sidecars/hashes, path safety, duplicate entries, size limits, supported metadata versions and typed dataset validity before workspace activation. Byte comparisons and hashes establish integrity and stale-write detection. `datasetMeaning`/`compareDatasets` establish separate definition and normalized-row meaning; container bytes, format, path and data revision are not semantic comparisons. Review displays schema and typed rows using full before/after fixture snapshots, including XLSX.

Modern Studio archives (v2/v3) accept managed fixtures only under `studio/fixtures/`; entries under `project/fixtures/` or root `fixtures/` are rejected before activation, including attempts to override a declared dataset or sidecar. V3 additionally requires exact manifest membership, sidecars and matching hashes. V1 archives deliberately migrate project-nested fixtures; v2 archives migrate Studio fixture files. Both receive validated sidecars through the same legacy migration. Plain project ZIPs remain supported. Unknown newer versions fail. Import/reset activate accepted data, replacement session and identity together. Export reads accepted snapshots and does not include dirty drafts or pending reviews.

## Verification

`src/datasetIntegration.test.ts` exercises real Workspace/IndexedDB, service, agent-turn/tool and preview-request boundaries. Its JOBDATA contract covers `0007`, 12.5, true, `TRUE`, normalized datetime, empty nonnullable text, nullable number/text, Unicode, quotes, commas, newline, literal null marker and formula-like text. It verifies save, CSV→XLSX→CSV, durable reload and ZIP import, comparing stable identity, ordered contracts, handles and normalized values. Further checks cover duplicate-code targeting, review acceptance/discard/failure/retry, schema-only draft conflicts, fixed/read-only/type policies, explicit imports, 1505-row paginated tools, automatic rollback and preview supersession during encoding.

`src/dataAdapter.test.ts` executes the generated kernel and authored adapter for standalone typed operations, to-do calls and legacy local storage. The isolated browser scenario verifies typed grid editing, actual iframe handle mutation, controlled agent growth, retained/copyable conflicting rows, recovery and durable reload without a provider request. See [browser instructions](../tests/browser/README.md).
