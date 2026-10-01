# Browser agent workflow review

Reviewed on 2026-10-01 using the local Studio UI, GPT-6 Luna through OpenRouter, and the existing TODAY task project. This review exercises the complete prompt, tool, diff, acceptance, preview, and export workflow. The generated app changes live in the browser workspace; harness fixes live in the repository.

## Changes requested through the agent

| Capability | Requested behavior |
| --- | --- |
| Fixture growth | Add priority and due date fields while preserving existing tasks and values. |
| Search and filters | Combine case-insensitive title search with All, Open, Completed, High priority, and Due soon filters. |
| Counts | Show total, open, completed, and currently shown task counts. |
| Empty results | Explain when no tasks match and provide Clear filters. |
| Narrow layout | Keep task controls usable in a preview around 300 pixels wide. |
| Editing feedback | Save title edits reliably and announce successful saves or errors. |

The first agent turn made 12 successful tool calls and proposed changes to `app.js`, `index.html`, `styles.css`, and `fixtures/todos.xlsx`. All four changes were reviewed and accepted through the UI. The agent preserved `data-store.js` and correctly stated that it had not run browser tests.

Testing exposed a title edit reverting after preview reload. A second request through the same chat produced changes to `app.js`, `index.html`, and `styles.css`, which were also reviewed and accepted through the UI. The agent added Enter and blur saving, title preservation during refreshes, blank-title feedback, and a separate accessible save status.

## Browser checks

| Check | Observed result |
| --- | --- |
| Search for `PROJECT` | Matched two titles regardless of case. |
| Search combined with Completed | Showed zero matches and an empty-results message. |
| Clear filters | Restored all 22 original tasks. |
| Completed filter | Showed six completed tasks and a shown count of six. |
| Due soon | Included the open task dated 2026-10-02 and excluded the later task dated 2026-10-10. |
| New task | Added one verification task with Low priority and date 2026-10-03. Counts became 23 total, 17 open, and six completed. |
| Completion toggle | Completing the verification task changed counts to 16 open and seven completed; reopening restored 17 and six. |
| Priority and date | Low priority and 2026-10-02 on an existing task survived preview and Studio reloads. |
| Narrow preview | At a 375-pixel Studio viewport, the project iframe measured 313 pixels for both client width and scroll width, with controls wrapping and no horizontal overflow. |
| Browser persistence | The accepted project, four chats, 23 tasks, and new fixture columns survived a full Studio reload. |
| Title save with Enter | Saved the verification title, displayed “Task title saved,” and retained the title, Low priority, and 2026-10-03 after preview reload. |
| Title save with blur | Moving focus saved another title edit; preview reload retained it and its other fields. |
| Blank title | Rejected a whitespace-only title, displayed an error, and restored the previous title. |
| Diff lifecycle | Switched among three changed files, closed and reopened review, then accepted changes without new browser warnings or errors. |
| Activity debugging | Collapsed and expanded activity, opened a tool's timing and input/output details, and confirmed the Errors filter showed no errors across 37 tool calls. |
| Export preparation | Opened the new ready dialog with a persistent Download ZIP link. Saving the file remains unverified in the in-app browser: the download event timed out and no new ZIP appeared in Downloads. |

## Harness fixes from this review

The fixture serializer previously wrote only the original column list. New fields appeared in preview memory but disappeared from the saved file. CSV and XLSX now append scalar row fields as columns, retain existing column order, and reject invalid cell values visibly. The agent's `write_table` tool follows the same rule and reports the saved columns. See [D-012](decisions.md#d-012-fixture-schema-growth).

Switching or accepting Monaco diffs exposed a model disposal error in the React wrapper. The diff component now detaches its models before disposing them and owns its subscriptions and model cleanup.

ZIP export previously displayed a success message immediately after triggering an asynchronous browser download. Export now prepares the archive and opens an explicit Download ZIP link that remains available until the dialog is closed.

## Local review artifacts

The current browser workspace contains the completed agent changes, all four chats, and 23 task rows. The extra verification task is named `Review agent workflow (verified)` with Low priority and due date 2026-10-03. Original task titles, completion flags, IDs, and creation times were preserved in the agent request and remain visible in the app; a downloaded-archive comparison has not been completed.

Screenshots of the colored diff, ZIP ready dialog, and final project with agent activity are stored in the ignored `review-artifacts/` directory. A ZIP backup from before the review is retained there as `before.zip`. Generated projects, chats, screenshots, and credentials are not committed with the harness source.

## Review scope

This is a local functional review of one generated project and one model. It is not a cross-browser, accessibility, performance, or deployment certification. All 16 automated tests passed, and the TypeScript and Vite production build passed. Regression checks cover fixture field persistence and staged agent table writes. The production build uses the exact package lock in a temporary clean build directory because dependency reads in the original Documents checkout stalled; no dependency versions were changed.
