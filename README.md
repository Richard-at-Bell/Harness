# Browser project studio

A browser-only workbench for small HTML, CSS, and JavaScript projects. It combines Monaco editing, a Pi-based agent, an isolated live preview, CSV/XLSX fixture tables, and a portable ZIP containing the project, chat, and tool activity. The first project is a to-do app.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in a current Chromium browser. The workspace commits accepted revisions atomically in IndexedDB and migrates older OPFS data without deleting its backup. The **Model settings** button accepts a user-provided OpenRouter key for the current tab only. The clickable [model picker](docs/model-selection.md) defaults to Claude Sonnet 5 and includes five alternatives.

```sh
npm test
npm run build
# Automated browser setup and isolation: tests/browser/README.md
npm run test:browser
```

The Vite output in `dist/` is a static site suitable for Vercel. No server API is required. Configure Vercel with the Vite framework preset or `npm run build` and `dist/` as the output directory.

## Current milestone

- Edit project files in Monaco and see an isolated live preview.
- Keep multiple agent chats, each with its own model, context, and activity log. File and table edits are staged in a diff before acceptance.
- Edit, import, convert, and generate CSV/XLSX fixture tables in Studio data. Preview table changes update Studio fixtures, separate from authored project files.
- Export a ZIP with `project/`, `studio/fixtures/`, all chats and tool logs, and `manifest.json`; reimport a studio or plain project ZIP.
- Run the exported project from a static server. Its data adapter persists changes to that browser's local storage and offers a CSV download, because a static site cannot rewrite source files on disk.

The design documents and open decisions are in [docs/README.md](docs/README.md). [Implementation status](docs/implementation-status.md) distinguishes working features from planned seams.

## Key handling

The API key is held in page memory and sent directly to OpenRouter for model requests. It is not stored in project files or the ZIP. The user should still review project content and chat before sharing an export.

See [state ownership and persistence guarantees](docs/state-ownership.md) for replacement phases, draft conflict recovery, migration and cross-tab limits.
