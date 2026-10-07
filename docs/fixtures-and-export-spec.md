# Fixtures and ZIP format

Status: **Draft for review** · Related decisions: [D-006](decisions.md#d-006-what-table-writes-mean-after-export), [D-007](decisions.md#d-007-fixture-formats)

## Table model

A fixture is a named table, not a mock API. Its schema declares ordered columns, a stable row ID column, primitive value types, nullable fields, and an optional generation recipe. Supported value types for the first release are text, number, boolean, date as ISO text, and empty. Formula execution, cell formatting, macros, charts, multiple joined sheets, and arbitrary workbook features are outside this model.

The current serializer preserves existing column order and appends new fields found in rows. Preview inserts/updates and the agent's `write_table` can therefore introduce fields such as `priority` or `due_date` without silently losing them. Nested objects, arrays, and nonfinite numbers fail with a readable error. Fields absent from older rows become empty cells. Explicit column rename, deletion, and type editing remain future work; the typed schema below is the planned richer contract.

The fixture service converts CSV or XLSX bytes into the normalized table model, validates values, and serializes rows back to the chosen file format. A fixture has one authoritative Studio data file, separate from project source files. The table editor and preview mutate the normalized table through the fixture service; serializing a mutation updates that file. The preview never edits spreadsheet bytes directly.

```ts
interface TableFixture {
  id: string;
  path: string;               // e.g. studio/fixtures/todos.csv in the ZIP
  format: "csv" | "xlsx";
  sheet?: string;             // required when format is xlsx
  idColumn: string;
  columns: Array<{ name: string; type: "text" | "number" | "boolean" | "date"; nullable: boolean }>;
  revision: string;
}
```

## Agent table creation

The agent uses `create_table` to add a Studio fixture and `write_table` to update one. Creation accepts a lowercase table name (1–60 letters, digits, underscores, or hyphens), unique nonempty ordered column names, optional scalar rows, and an optional `csv` or `xlsx` format. CSV is the default. Empty tables retain their declared columns. The current tool accepts at most 1,000 initial rows and refuses an existing table name in either format. It never replaces another table.

A created table is staged when review is on and saved before tool success when review is off. Save failures roll back the staged creation; concurrent creation of the same table in another format is rejected. Managed tables are available through `list_tables`, `read_table`, and the preview bridge. `fixture-seed.js` remains derived output and cannot substitute for a missing Studio table.

## To-do reference fixture

`fixtures/todos.csv` starts with `id,title,completed,created_at`. `id` is unique and stable; `title` is nonempty text; `completed` is boolean; `created_at` is an ISO 8601 timestamp. The template includes a few sample rows, including a completed task and a title containing a comma to prove CSV quoting works. The UI can regenerate them from a saved seed and fixed reference date.

Generation is deterministic for the current table editor: the same schema and seed produce the same rows. Persisting recipes and generator versions in `studio/fixture-recipes.json` is a later seam. Regeneration previews rows before save. Faker supports seeded generation but its output can change across versions, and relative dates need a fixed reference date. [Faker guidance](https://fakerjs.dev/guide/usage)

## CSV and XLSX behavior

| Operation | CSV | XLSX |
| --- | --- | --- |
| Create/generated data | Yes | Yes, from the normalized table |
| Import | Header row mapped to schema | User selects one worksheet and maps its header row |
| Preview read/write | Through normalized table bridge | Through the same bridge |
| Save to Studio data | UTF-8 CSV with stable column order | Workbook with one data sheet for that fixture |
| Round-trip guarantee | Supported typed values and row order | Supported typed values, selected sheet name, and row order |

When importing an XLSX, the user sees a warning that workbook styling, formulas, and unrelated sheets are not preserved by the table model. CSV export quotes correctly and neutralizes spreadsheet formula-like text on export. The browser implementation must round-trip both formats in a prototype before XLSX is committed to the first release.

## What a project can change

Inside the **studio preview**, `app.js` uses the generated `data-store.js` adapter to list and mutate `todos`. The adapter sends a request to the studio's table bridge. The studio writes the updated CSV or XLSX file to Studio data. Subsequent previews and the exported ZIP use those updated rows.

The adapter exposes a plain JavaScript API to authored code: `list(tableId)`, `insert(tableId, row)`, `update(tableId, rowId, patch)`, and `remove(tableId, rowId)`, all returning promises, plus `subscribe(tableId, callback)` for change notifications. IDs are assigned or validated by the fixture service. An edit to a missing row fails explicitly. This same API uses the preview bridge in the studio and local browser persistence in the standalone site, so `app.js` does not need two code paths.

Outside the studio, an exported static web page cannot silently rewrite its packaged CSV/XLSX file on disk. At export, the builder derives `fixture-seed.js` from the current Studio fixture rows. The standalone adapter reads those initial rows, stores later changes in that browser's local storage, and offers an explicit **Download updated table** action. `fixture-seed.js` is generated output; the CSV/XLSX in `studio/fixtures/` is the authoritative file. If the user imports the downloaded table back into the studio, it becomes the Studio fixture. This keeps the project runnable without a backend. Whether the standalone app should instead require a user-selected writable file is [D-006](decisions.md#d-006-what-table-writes-mean-after-export).

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
│   └── README.md
└── studio/
    ├── fixtures/
    │   └── todos.csv             # or todos.xlsx
    ├── chats.json                # chat titles, models, and IDs
    ├── chat.jsonl                # messages tagged with chatId
    └── tool-events.jsonl         # tool events tagged with chatId
```

`manifest.json` records format version 2, export time, entry file, fixture file list, active chat ID, and SHA-256 hashes. `chats.json` describes each chat; `chat.jsonl` and `tool-events.jsonl` carry all conversations and logs tagged with chat IDs. Pi's internal context remains browser-local and is not exported. Studio-managed credentials and authorization headers are excluded. Checkpoints and generation recipes remain future additions to the ZIP.

The exporter creates the ZIP from the accepted project and Studio data snapshots, then offers the download. The importer rejects path traversal, duplicate names, oversized entries, and unsupported versions before committing any data. It migrates v1 ZIP fixtures from `project/fixtures/` to `studio/fixtures/`. The project README explains how to serve the static site locally and how standalone table persistence works.
