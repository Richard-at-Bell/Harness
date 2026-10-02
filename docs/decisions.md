# Decision register

Status: **Draft for review** · 2026-09-28

**Proposed** means the specs use that choice as the working default. **Open** means the stated alternatives materially change behavior and should be chosen before implementation of that seam. Decision IDs remain stable even if their outcomes change.

## D-001: Project language

**Proposed:** The studio is TypeScript; authored projects are vanilla HTML, CSS, and JavaScript. The first template is a to-do app. JavaScript is required for interaction and fixture writes. No TypeScript or build step is required in the exported project.

**Why:** It matches the requested authoring experience and makes a small static project previewable without a package runtime.

## D-002: Model credentials

**Proposed:** Bring your own API key. Keep it in memory for the current browser session by default; never place it in project files or the ZIP. Support only providers that the browser can call under their current CORS and auth rules.

**Open subchoice:** Should the studio offer optional encrypted local key storage, or require entry after every reload? The first implementation can safely start with session-only keys.

## D-003: Browser workspace

**Proposed:** OPFS stores project files and Studio fixture files in separate roots; IndexedDB stores chats and active selection. The ZIP is the portable backup. Importing a physical folder and writing directly back to it are later features because directory-picker support varies by browser. [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [directory picker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)

## D-004: Preview runtime

**Proposed:** Materialize static project files into a sandboxed iframe with a narrow message bridge for fixture data. Support HTML/CSS/JS, local assets, and no npm commands. Prototype the materializer and isolation before treating this as final.

**Alternative:** WebContainers would support more Node-style development and live servers, but add browser constraints and commercial production licensing. [WebContainers](https://webcontainers.io/guides/quickstart), [license](https://webcontainers.io/enterprise)

**Review question:** Is the intended project universe strictly static sites, or should a near-term release run npm-based frameworks?

## D-005: Agent integration

**Proposed:** Use Pi's browser-capable agent core and model layer with custom workspace tools. Do not attempt to bundle the Node/Bun coding-agent SDK into the static studio. [Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md), [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

**Seam:** Pi receives a tool interface; the workspace service owns writes and review checkpoints. This preserves the option to change agent runtime later.

## D-006: What table writes mean after export

**Open. Proposed default:** In the studio, preview mutations update the Studio CSV/XLSX fixture and therefore the final ZIP. In the standalone exported site, mutations persist in browser local storage and users can download an updated table. A static web page cannot silently overwrite its packaged file on a user's disk.

**Alternative:** Require the standalone app to ask the user to select a local writable file. That offers direct file writeback on supporting browsers but adds permission prompts and narrower compatibility.

**Review question:** Is it enough that fixture changes become real files while the project is in the studio, with local persistence and explicit table download after export?

## D-007: Fixture formats

**Open. Proposed default:** CSV and constrained one-sheet XLSX are both offered. CSV is the initial template and easiest format to inspect in a diff. XLSX is treated as table data; formulas, styling, and extra sheets are not preserved. The XLSX library must pass a browser import/edit/export round-trip spike before this choice is accepted.

**Alternative:** Ship CSV first and add XLSX in a second milestone. The table service interface stays the same.

## D-008: Agent change approval

**Implemented default:** Review changes is on. Each agent turn stages its file and fixture edits, opens a diff, and waits for acceptance or discard. The switch above the chat input can turn review off. In that mode, every successful mutation is saved immediately and reflected in the preview, so another prompt can run without an acceptance step.

The setting is stored in this browser's IndexedDB, separately from chats and exported projects. It is fixed for the duration of a turn and while changes await review. Automatic edits update only the affected path and reject a write if that path changed during the tool operation. Successful edits remain applied if a later tool or model request fails. There is no automatic undo checkpoint yet; chat and tool activity remain available in both modes.

**Review question:** Should the preview optionally run staged agent changes before acceptance? This can be added later without changing the file format.

## D-009: Browser support

**Proposed:** Optimize and test the first release on current desktop Chromium, then extend to Safari and Firefox after the preview, file, and provider compatibility checks. Do not describe unsupported browsers as working until verified.

## D-010: Studio fixture ownership

**Implemented default:** CSV/XLSX fixtures live in the Studio data store and export under `studio/fixtures/`. The `project/` directory contains authored HTML/CSS/JavaScript and a generated `fixture-seed.js` for standalone runtime data. Existing browser workspaces and v1 ZIPs migrate project fixture files into Studio data.

## D-011: Multiple chats

**Implemented default:** A workspace has multiple named chats. Each chat owns its model selection, visible transcript, tool activity, and Pi context. The project and Studio fixtures are shared across chats. Switching chats is held while a turn is running or staged changes await review, so the change set stays attached to its originating chat. ZIP v2 includes every chat and log; Pi context is local browser state and is not exported.

## D-012: Fixture schema growth

**Implemented default:** New scalar fields from preview mutations or `write_table` append columns to CSV/XLSX fixtures. Existing columns retain their order. Old rows receive empty cells for added fields, and invalid nested values fail visibly. Agent table writes include the saved column list in their response. This makes adding app features such as priority and due dates possible through the agent workflow. Column rename, removal, and explicit types need a later schema editor.

**Evidence:** Browser testing reproduced priorities returning to Medium after reload because the old serializer discarded fields outside the original four columns. Both CSV and XLSX now have regression checks for new fields surviving later saves.
