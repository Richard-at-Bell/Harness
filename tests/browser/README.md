# Isolated browser regression tests

Install development dependencies and a Playwright browser, then run:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

On a machine with Chrome already installed, including the development machine used for this change:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
npm run measure:storage
```

The measurement script defaults to installed Chrome; `PLAYWRIGHT_CHANNEL` can select another installed browser channel. It measures a 100 MB workspace in a fresh temporary profile and deletes its benchmark database afterward.

Playwright starts Vite on `127.0.0.1:4318`, creates a fresh browser context for every test and uses `tests/browser/harness.html`. No existing user tab/profile/project or provider key is used. The separate harness shares the production App, runtime, storage and Monaco setup; it injects faults only at meaningful storage boundaries. The controlled agent runner exercises ordinary turn/tool commits without a provider request. The harness and its test controls are excluded from the production bundle.

Coverage includes typing, file/view navigation, cursor/undo, save failure/retry, committed data after reload, file/table conflicts and explicit recovery, replacement failure/success, model disposal, actual legacy OPFS migration, two tabs sharing IndexedDB, and CSV/XLSX conversion rollback/retry. Failing tests retain Playwright traces in ignored `test-results/`. Unit tests use `fake-indexeddb` for deterministic failure and corruption/recovery checks; these browser tests cover the actual Chromium APIs. They do not emulate a power loss or guarantee origin retention.
