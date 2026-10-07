# Browser agent workflow review

## Food diary conversion on October 5 2026

The to-do project was converted into **Plate**, a daily food diary, by submitting three prompts through the Studio chat UI with GPT-6 Luna through OpenRouter. Review was disabled. The in-app agent made all generated HTML, CSS, JavaScript, and initial fixture changes. Browser controls were used to exercise the result. Harness fixes were made in repository source.

### Agent turns and repairs

| Turn | Tool calls | Outcome |
| --- | --- | --- |
| Build Plate | 43, including 3 errors | Replaced the to-do UI, but could not create managed tables. A missing-table write, a fixture-path file write, and an exact-text edit failed. The agent rewrote the adapter and added a fallback seed; the preview still reported `Table meals was not found`. |
| Create managed fixtures | 19, no additional errors | After the harness gained `create_table`, the agent created `meals.csv` and an empty `settings.csv`, removed the temporary project seed and its script reference, and shortened the intro. |
| Repair deletion | 13, no additional errors | Replaced unavailable `window.confirm` with an in-page confirmation dialog. Existing rows were retained for the browser deletion check. |

The chat retains all three prompts, responses, and 75 tool records, including the three original errors. The agent correctly stated that it had not run browser tests. Automatic application also briefly exposed incompatible HTML/JavaScript during the first turn; an interim preview raised a null `addEventListener` error. A successful final preview does not erase these earlier failures.

### Browser checks

| Check | Observed result |
| --- | --- |
| Daily summary | October 5 samples total 1,040 kcal, 45 g protein, 139 g carbs, and 35 g fat. These values match sums from the managed meal rows. |
| Date filtering | October 4 shows only its fictional dinner: 620 kcal, 42 g protein, 38 g carbs, and 31 g fat. October 5 restores its three samples. |
| Add food | A fictional 165-kcal snack with 10/20/5 g macros saved to `meals.csv`; totals became 1,205 kcal and 55/159/40 g. |
| Edit food | Renaming that snack and changing it to 200 kcal produced a saved 1,240-kcal daily total. |
| Goal and persistence | An example goal of 2,000 kcal saved to `settings.csv` and showed 62% progress. The edited snack, goal, project, chat, and 62 tool records survived a full Studio reload. |
| Delete and cancel | The repaired dialog named the food. Escape cancelled and returned focus to its Delete button. Confirming deletion removed only the disposable snack and returned totals to 1,040 kcal and 52% progress. |
| Clear goal | Clear goal restored “Not set”; a subsequent preview reload retained the unset goal and the four original meal rows. |
| Existing data | All three original `todos` rows retained their IDs, titles, completion flags, creation times, and priorities. They remain available in Studio data. |
| Narrow form | At a requested 375-pixel Studio viewport, the project document measured 334 pixels for both client and scroll width. The food form's fields and Save/Cancel controls fit. Normal viewport sizing was restored. |
| Fragment navigation | Clicking Plate home initially loaded the Studio URL inside the iframe. After the materializer fix, it scrolled within Plate and the document title remained `Plate — daily food diary`. |

### Harness changes and scope

- Added `create_table` for CSV/XLSX fixtures with declared columns, optional initial rows, duplicate-name rejection across formats, and the existing review/automatic-save contracts. Tests cover schema retention, malformed values, failed saves, and concurrent creation.
- Added agent guidance to use managed fixture creation and preserve the adapter, and to use in-page dialogs in the sandbox.
- Kept fragment links inside the preview document instead of resolving them against the Studio's inherited `srcdoc` base URL. A regression test covers decoded and empty fragments, missing targets, malformed encoding, and ignored external/modified clicks.

All 75 unit tests and the production build passed. The existing large-bundle warning remains. This review covers one model and the in-app browser; it does not certify cross-browser behavior or standalone export. ZIP download behavior was not retested in this conversion and remains unverified from the earlier review.

The browser workspace now contains Plate, `meals.csv` with four fictional samples, `settings.csv` with no goal, the unchanged `todos.csv`, and three chats. Repository screenshots are ignored: `review-artifacts/2026-10-05-plate.png` and `review-artifacts/2026-10-05-plate-narrow.png`. The generated project remains browser-local.

## Earlier to-do review on October 5 2026

The latest committed harness was exercised through the local Studio chat UI with GPT-6 Luna through OpenRouter. Two live agent turns made 23 successful tool calls. Generated project edits and fixture writes were performed by the in-app agent; verification used browser controls.

The first turn ran with Review changes enabled. It added case-insensitive search, All/Open/Completed filters, a shown count, empty-result feedback, and sunflower accents in `index.html`, `app.js`, and `styles.css`. All three diffs were inspected, including closing and reopening review. The preview retained the original project until the changes were accepted.

The second turn ran with review disabled. It added priority selectors and ordering in `app.js` and `styles.css`, and saved a new `priority` column in the CSV fixture. Studio data adopted the new column automatically. The three original rows retained every original ID, title, completion flag, and timestamp. Their priorities are High, Normal, and Low respectively. `data-store.js` was not changed.

| Check | Observed result |
| --- | --- |
| Search and filters | `REVIEW` matched one task. Combining it with Completed produced zero results. Clear filters restored all three tasks. Open showed two tasks; Completed showed one. |
| Priority writes | Changing the first task to Low reordered the open tasks and survived preview reload. High was restored afterward. |
| Task mutations | A temporary task defaulted to Normal. Its edited title and completion flag survived a full Studio reload. The temporary task was removed after verification. |
| Reload persistence | The project changes, priorities, two chats, 23 tool records, and disabled review preference survived a full reload. The API key was restored through its settings field because keys intentionally stay in tab memory. |
| Narrow preview | At a requested 375-pixel Studio viewport, the project document measured 351 pixels for both client width and scroll width. Priority controls stayed inside the document. The agent was hidden to inspect the preview, and normal sizing was restored afterward. |
| Panel lifetime | An unsent prompt survived hiding and reopening the agent panel. The original prompt was restored after this check. |
| Activity details | The Errors filter reported no errors. A completed tool exposed its status, start time, duration, input/output summaries, and call ID. |
| ZIP export | The export-ready dialog and Download ZIP link were produced. Clicking the link and using the browser download API did not produce a completed download event; saving the ZIP remains unverified in this in-app browser. |

All 67 unit tests and the production build passed before the live review. No harness source fix was required for the verified editing flows. Download behavior remains an unresolved browser check; ZIP preparation alone is not evidence of a saved archive.

At the end of that to-do review, the completed project and its two chats were in the browser workspace, with the original three fixture rows and the new priority column. Screenshots are retained in the ignored `review-artifacts/` directory with the `2026-10-05-` prefix.

## Earlier review on October 1 2026

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
