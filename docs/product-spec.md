# Product specification

Status: **Draft for review** · Related decisions: [D-001](decisions.md#d-001-project-language), [D-002](decisions.md#d-002-model-credentials), [D-004](decisions.md#d-004-preview-runtime)

## Product promise

A user opens a browser, starts from a small web template or imports a project ZIP, chats with an agent that can read and edit project files, reviews the resulting changes, sees the page update in a live preview, edits or generates table data, and downloads a portable ZIP containing the completed project, conversation, and logs.

The studio application is TypeScript. Projects created in the studio use HTML, CSS, and plain JavaScript. JavaScript is needed for to-do interactions and table reads/writes; a project author need not use TypeScript, npm, or a framework.

## Primary user journey

1. **Create or import.** Choose the to-do template, a blank static site, or a ZIP containing supported project files. The studio creates a browser-local workspace and a baseline checkpoint.
2. **Configure a model.** Select a supported provider and enter a personal API key. The key stays outside project files, logs, and the exported ZIP. The UI verifies that the provider can be called from the browser before a chat starts.
3. **Work with the agent.** The user asks for a change. The agent reads files and proposes edits through the workspace tool API. The chat shows tool actions and errors. A complete agent turn produces a reviewable diff against its starting checkpoint.
4. **Review.** The user accepts the turn or reverts its file changes. Manual Monaco edits are saved directly and remain visible in subsequent diffs.
5. **Preview.** The preview reloads from the current accepted workspace after file edits. The user can interact with the to-do app. Preview errors and console messages appear in a studio panel without giving the preview access to model credentials or the studio DOM.
6. **Work with data.** The user views the `todos` table, generates a seeded example, imports CSV/XLSX, and chooses a file format. The preview can read and change rows through a narrow data bridge. Changes are reflected in the workspace's table file and in the final ZIP.
7. **Export and resume.** Download a ZIP with the project, fixtures, session transcript, tool log, and manifest. Importing that ZIP into the studio restores the project and review history supported by the manifest version.

## Reference project: to-do app

The initial template contains `index.html`, `styles.css`, `app.js`, a small standalone data adapter, and `fixtures/todos.csv`. The export adds `fixture-seed.js` derived from the latest table so the standalone app can load initial rows without a server. The page lists tasks, adds a task, edits a title, toggles completion, and deletes a task. It shows an empty state and a visible error if the fixture cannot be read. It does not require a package install.

Example prompt: “Make completed tasks move to the bottom and add a count of open tasks.” The agent should edit `app.js` and, if needed, `styles.css`. The user should see those exact diffs and the preview should update after acceptance.

## First-release requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| P-01 | Create the reference project | The to-do app opens and works in preview with fixture rows. |
| P-02 | Edit HTML, CSS, and JS | Monaco saves edits; preview shows them without a full studio reload. |
| P-03 | Agent file edits | An agent can list, read, create, edit, and delete allowed workspace files; each turn has a diff and tool record. |
| P-04 | Review and recovery | Accept/revert works for an agent turn; reload restores accepted files and chat. |
| P-05 | Table fixtures | Import, generate, inspect, and edit a table; CSV and XLSX have the constrained behavior in the fixture spec. |
| P-06 | Preview table writes | Adding or toggling a to-do row changes the workspace table and survives a studio reload. |
| P-07 | Portable output | The ZIP contains a runnable static project, current fixture files, chat, logs, and a versioned manifest. |
| P-08 | Safe isolation | Project script cannot read the studio's model key, OPFS files outside its project, or parent DOM. |
| P-09 | No managed backend | The studio shell loads from Vercel static assets; model calls use the user's key. |

## Quality targets

- A new user can reach a working to-do preview from the template in under a minute, excluding model setup.
- A bad agent edit never destroys the accepted checkpoint. A failed import or export leaves the existing workspace intact.
- Browser refresh preserves accepted source files, fixture changes, and completed chat turns.
- The first release targets current desktop Chromium. Other browser support is a separate compatibility pass because preview and local file APIs differ across browsers.
- Export is useful without a studio account. It contains no API key and no hidden dependency on the studio service.

## Outside the first release

Multi-user collaboration, Git hosting, arbitrary server-side languages, package installation, terminals, user-deployed APIs, and automatic writes to a user's local folder are outside the first release. The preview runtime is designed behind an interface so a later Node-compatible runtime can be evaluated without changing the editor or agent file contracts.
