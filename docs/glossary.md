# Specification glossary

Status: **Draft for review**

| Term | Meaning in this product |
| --- | --- |
| **Studio** | The TypeScript web application deployed on Vercel. It provides editor, chat, preview, fixtures, and export. |
| **Project** | The user's authored HTML/CSS/JavaScript site and assets. It is the `project/` directory in an export. |
| **Workspace** | The mutable browser-local project, Studio fixtures, and chat metadata. It is private to this site's browser origin. |
| **Workspace service** | The sole file API used by Monaco, the agent, fixtures, preview builder, and exporter. |
| **OPFS** | Origin private file system: the legacy browser storage for project bytes, retained as a migration backup. It is not an ordinary folder visible in Finder or Explorer. |
| **IndexedDB** | Authoritative browser database for accepted workspace revisions and session metadata. |
| **Pi agent core** | The browser-usable part of Pi that runs conversation turns and tool calls. It is distinct from Pi's Node/Bun coding-agent SDK. |
| **Agent tool** | A validated operation the model can request, such as reading a file or changing a table. The workspace service executes it. |
| **Turn** | One user request and the agent's resulting messages and tool activity until it settles. |
| **Checkpoint** | A recoverable workspace state captured before a change set. |
| **Staged change** | An agent file change awaiting user acceptance. It does not become the accepted project until reviewed. |
| **Review changes** | The browser preference that chooses whether agent edits wait for acceptance. It defaults to on and is locked during an active turn or pending review. |
| **Automatic application** | With review off, each successful agent file or fixture mutation is saved immediately and shown in the preview. Earlier successful edits remain applied if the turn later fails. |
| **Accepted revision** | The current project state used by the live preview and ZIP export. |
| **Revision** | An identifier for a particular file, table, or workspace state, used to detect stale writes. |
| **Diff** | The before/after view of changed text files for a turn or checkpoint. |
| **Preview** | An isolated iframe running a materialized copy of the accepted project in the browser. |
| **Preview bridge** | A narrow message protocol between the isolated project preview and the studio's fixture service. |
| **Fixture** | A named CSV/XLSX table owned by Studio data. The preview reads and changes it through the bridge; it is separate from project source files. |
| **Table creation** | The agent’s `create_table` operation adds a named CSV/XLSX Studio fixture with ordered columns and optional rows. It follows the selected review mode and refuses an existing table identity. |
| **Chat** | One agent conversation with its own transcript, tool activity, model selection, and local Pi context. Chats share the project and fixtures. |
| **Normalized table** | The in-memory row and column representation used to read, validate, edit, and serialize either fixture format. |
| **Generation recipe** | Schema, seed, reference date, and generator version used to reproduce a sample table. |
| **BYOK** | Bring your own key: the user provides a model provider API key for calls made from their browser. |
| **Portable ZIP** | The download containing the runnable project plus studio chat, logs, recipes, checkpoints, and manifest. |
| **Manifest** | Versioned metadata that describes the ZIP layout, project revision, fixture files, and integrity hashes. |
| **Standalone project** | The exported site running outside the studio. It can read bundled initial fixture data, but browser rules limit direct writes to packaged files. |
| **Fixture seed asset** | Generated `fixture-seed.js` in the exported project. It carries initial table rows for standalone use and is derived from the authoritative CSV/XLSX fixture. |
