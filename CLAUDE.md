# CLAUDE.md — execa fork

## Project Overview

This is a fork of [execa](https://github.com/sindresorhus/execa), a TypeScript
library that provides a human-friendly API for running shell commands in Node.js.
It wraps Node's built-in `child_process` module with better Promise support,
error handling, and output capture.

## Codebase Structure

- `lib/` — core library source files (TypeScript)
- `test/` — AVA test files, mirrors structure of `lib/`
- `index.d.ts` — public type definitions
- `readme.md` — API documentation; must stay in sync with code changes

## PR Review Rules

### Rule 1: Every new public function must have a JSDoc comment

Any function exported from `lib/` or typed in `index.d.ts` must have a JSDoc
block explaining its purpose and parameters. Flag any PR that adds a public
function without one.

### Rule 2: No floating promises

All async functions must have proper error handling. Flag any `await` call not
wrapped in try/catch, and any Promise not chained with `.catch()`.
Do not approve patterns like `someAsyncFn()` with no error handling.

### Rule 3: New options require README documentation

If a PR introduces a new option or parameter to the public API, the `readme.md`
must be updated in the same PR. Flag if the README has not been touched.

### Rule 4: Test file required for new source files

Every new file added under `lib/` must have a corresponding test file under
`test/`. Flag any PR that adds a `lib/foo.ts` without a `test/foo.ts`.

## How to Run Tests

```bash
npm test
```

Tests use the AVA framework. Always run tests after reviewing a diff to verify
nothing is broken.

## Agent Behavior

- When reviewing a PR diff, check each rule above explicitly and call out
  violations by file and line number.
- Do not approve a PR if any rule is violated — list what needs fixing.
- Be concise in feedback: one line per violation, actionable.
