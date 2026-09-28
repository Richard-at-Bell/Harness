# Fixtures and ZIP format

Status: **Draft for review** · Related decisions: [D-006](decisions.md#d-006-what-table-writes-mean-after-export), [D-007](decisions.md#d-007-fixture-formats)

## Table model

A fixture is a named table, not a mock API. Its schema declares ordered columns, a stable row ID column, primitive value types, nullable fields, and an optional generation recipe. Supported value types for the first release are text, number, boolean, date as ISO text, and empty. Formula execution, cell formatting, macros, charts, multiple joined sheets, and arbitrary workbook features are outside this model.

The fixture service converts CSV or XLSX bytes into the normalized table model, validates values, and serializes rows back to the chosen file format. A fixture has one authoritative workspace file. The table editor and preview mutate the normalized table through the fixture service; serializing a mutation updates that file. The preview never edits spreadsheet bytes directly.

```ts
interface TableFixture {
  id: string;
  path: string;               // e.g. fixtures/todos.csv
  format: "csv" | "xlsx";
  sheet?: string;             // required when format is xlsx
  idColumn: string;
  columns: Array<{ name: string; type: "text" | "number" | "boolean" | "date"; nullable: boolean }>;
  revision: string;
}
```

## To-do reference fixture

`fixtures/todos.csv` starts with `id,title,completed,created_at`. `id` is unique and stable; `title` is nonempty text; `completed` is boolean; `created_at` is an ISO 8601 timestamp. The template includes a few sample rows, including a completed task and a title containing a comma to prove CSV quoting works. The UI can regenerate them from a saved seed and fixed reference date.

Generation is deterministic within a pinned generator version: same schema, seed, reference date, and version yield the same rows. The recipe is stored in `studio/fixture-recipes.json` inside the ZIP. Regeneration is a reviewable workspace change and cannot silently overwrite hand-edited rows. Faker supports seeded generation but its output can change across versions, and relative dates need a fixed reference date. [Faker guidance](https://fakerjs.dev/guide/usage)

## CSV and XLSX behavior

| Operation | CSV | XLSX |
| --- | --- | --- |
| Create/generated data | Yes | Yes, from the normalized table |
| Import | Header row mapped to schema | User selects one worksheet and maps its header row |
| Preview read/write | Through normalized table bridge | Through the same bridge |
| Save to workspace | UTF-8 CSV with stable column order | Workbook with one data sheet for that fixture |
| Round-trip guarantee | Supported typed values and row order | Supported typed values, selected sheet name, and row order |

When importing an XLSX, the user sees a warning that workbook styling, formulas, and unrelated sheets are not preserved by the table model. CSV export quotes correctly and neutralizes spreadsheet formula-like text on export. The browser implementation must round-trip both formats in a prototype before XLSX is committed to the first release.

## What a project can change

Inside the **studio preview**, `app.js` uses the generated `data-store.js` adapter to list and mutate `todos`. The adapter sends a request to the studio's table bridge. The studio writes the updated CSV or XLSX file to the workspace. Subsequent previews and the exported ZIP use those updated rows.

The adapter exposes a plain JavaScript API to authored code: `list(tableId)`, `insert(tableId, row)`, `update(tableId, rowId, patch)`, and `remove(tableId, rowId)`, all returning promises, plus `subscribe(tableId, callback)` for change notifications. IDs are assigned or validated by the fixture service. An edit to a missing row fails explicitly. This same API uses the preview bridge in the studio and local browser persistence in the standalone site, so `app.js` does not need two code paths.

Outside the studio, an exported static web page cannot silently rewrite its packaged CSV/XLSX file on disk. At export, the builder derives `fixture-seed.js` from the current fixture rows. The proposed standalone adapter reads those initial rows, stores later changes in that browser's local storage, and offers an explicit **Download updated table** action. `fixture-seed.js` is generated output; the CSV/XLSX is the authoritative file in the studio. If the user imports the downloaded table back into the studio, it becomes the workspace file. This keeps the project runnable without a backend. Whether the standalone app should instead require a user-selected writable file is [D-006](decisions.md#d-006-what-table-writes-mean-after-export).

## ZIP layout

```text
project-studio-export.zip
├── manifest.json
├── project/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── data-store.js
│   ├── fixture-seed.js          # derived from current fixture rows
│   ├── fixtures/
│   │   └── todos.csv             # or todos.xlsx
│   └── README.md
└── studio/
    ├── chat.jsonl
    ├── tool-events.jsonl
    ├── fixture-recipes.json
    ├── checkpoints.json
    └── changes.jsonl            # before/after data for reviewed text edits
```

`manifest.json` records format version, project ID, title, export time, accepted workspace revision, entry file, fixture descriptors, generator versions, and SHA-256 hashes of exported files. `chat.jsonl` contains completed user and agent messages; `tool-events.jsonl` contains tool attempts and results. `checkpoints.json` identifies reviewed turns; `changes.jsonl` keeps the before/after text needed to show their diffs after reimport. The current project files remain the source of truth. Studio-managed credentials, authorization headers, provider response headers, and browser storage unrelated to the project are excluded. Known key values are redacted from chats and logs; the export UI lets the user review project content that might contain secrets they entered themselves.

The exporter creates the ZIP from a frozen snapshot, validates its own manifest and hashes, then offers the download. The importer rejects path traversal, duplicate names, unexpected oversized entries, and invalid schemas before committing any data. The project README explains how to serve the static site locally and how standalone table persistence works.
