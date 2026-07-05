# B2I Pinned Test Runner

Runner choice: `node --import tsx --test` with `--conditions=react-server`.

Why this satisfies B2I constraints:

1. TypeScript execution: `tsx` transpiles `.ts` tests directly.
2. `@/*` path aliases: `tsx` reads `tsconfig.json` path mappings.
3. `node:test` compatibility: tests use native `node:test` and run under Node's test runner.
4. `react-server` condition: script passes `--conditions=react-server` so server-only imports resolve on the intended branch.
5. Module mocking: route tests use `Module._load` interception under `tsx`-transpiled dynamic import to replace `getAuthenticatedAdminUser` and selected server dependencies.

This runner is pinned as a repository dev dependency (no ephemeral `npx` install).
