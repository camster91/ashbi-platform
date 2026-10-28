# Frontend tests

`npm test --prefix web` runs Vitest with three projects (`web/vitest.config.js`):

| Project | Folder | Environment | Why |
|---|---|---|---|
| `contracts` | `web/src/tests/contracts/` | Node, `isolate: false` | Source-reading guards and pure-module tests. No jsdom start per file. |
| `dom` | `web/src/tests/` (everything else) | jsdom, `pool: 'vmThreads'` | Rendered component, hook and API tests. |
| `dom-forks` | the files listed in `FORKS_TESTS` | jsdom, forks pool | Tests that replace `window.location` or `performance` methods, which jsdom keeps unforgeable under vmThreads. |

Run one project with `npx vitest run --project contracts` (from `web/`).

## Where a new test goes

- Reads source files or calls a plain module, with no mocks, stubbed
  globals, fake timers or rendering: `src/tests/contracts/`.
  `contracts-folder-guard.test.js` fails if one of those creeps in, because
  files in that project share module state.
- Everything else: `src/tests/`.
- Replaces `window.location` or other browser objects jsdom will not let go:
  `src/tests/`, and add the file to `FORKS_TESTS`.

## Grouped files

Related source contracts live together, one `describe` block per original
area, for example `layout.contract.test.js` (shell), `client-portal.contract.test.js`,
`portal-pages.contract.test.js`, `page-actions-accessibility.contract.test.js`,
`workflow-state.contract.test.js` and `finance-workflow-state.contract.test.js`.
Add a new block to the matching file rather than a new file.

Workflow contracts for invoices, rate cards and the asset library share
`contracts/finance-workflow-state.contract.test.js`. Gmail reply and semantic
search contracts share `contracts/workflow-state.contract.test.js`. These tests
read source and use Node, without a jsdom environment. Date-only helpers and
telemetry scrubbing also run in Node. Markdown rendering tests retain jsdom
because the sanitizer uses browser APIs.
