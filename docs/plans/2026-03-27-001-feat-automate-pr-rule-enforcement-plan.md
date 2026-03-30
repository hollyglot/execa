---
title: "feat: Automate PR Rule Enforcement via ESLint and CI"
type: feat
status: completed
date: 2026-03-27
origin: docs/brainstorms/2026-03-24-automate-pr-rules-requirements.md
---

# feat: Automate PR Rule Enforcement via ESLint and CI

## Overview

Three of the four manual PR review rules in `AGENTS.md` (Rules 1, 2, and 4) are mechanically verifiable. This plan converts them into hard CI gates: a JSDoc lint rule, a floating-promise lint rule, and a test-file pairing script. Rule 3 (README sync) is excluded by design (see origin document).

The work has three distinct parts that can be implemented independently:
- **Part A** — Rule 4: test-file pairing check (standalone script, lowest risk)
- **Part B** — Rule 1: JSDoc enforcement (lint rule + writing JSDoc for public exports)
- **Part C** — Rule 3: no-floating-promises enforcement (type-aware linting setup)

## Problem Statement / Motivation

AGENTS.md defines four PR rules that today depend entirely on human reviewers catching violations at review time. A missed floating promise or a missing test file costs an author→reviewer round-trip. Automating three of the four rules eliminates that class of feedback delay permanently and makes the rules impossible to bypass silently.

(see origin: `docs/brainstorms/2026-03-24-automate-pr-rules-requirements.md`)

## Proposed Solution

### Part A: Rule 4 — Test File Pairing Check

A Node.js script (`scripts/check-test-pairing.js`) that runs in CI after `npm run lint`:

- For every `lib/**/*.js` file, assert that at least one `test/**/<basename>*.js` file exists
- Uses **prefix matching** — `lib/io/output.js` passes if any of `test/io/output.js`, `test/io/output-async.js`, `test/io/output-options.js` etc. exist
- Ships with a **grandfathered allowlist** of the 36 existing lib/ files that currently have no test/ counterpart, so the check passes on day one
- Fails with a clear error message naming the missing test file and pointing to AGENTS.md Rule 4

Added to `package.json` as `"check-pairing": "node scripts/check-test-pairing.js"` and called in `.github/workflows/main.yml`.

### Part B: Rule 1 — JSDoc Enforcement

Enable `jsdoc/require-jsdoc` in the XO config scoped to **`index.js` only** (see Technical Considerations for scope rationale), requiring JSDoc on all exported declarations. XO v0.60 does **not** bundle `eslint-plugin-jsdoc` — adding it as a new devDependency is required.

Write JSDoc blocks for all ~13 public API exports currently defined or re-exported in `index.js`:
`execa`, `execaSync`, `execaCommand`, `execaCommandSync`, `execaNode`, `$`, `parseCommandString`, `ExecaError`, `ExecaSyncError`, `sendMessage`, `getOneMessage`, `getEachMessage`, `getCancelSignal`.

### Part C: Rule 2 — No-Floating-Promises Enforcement

`@typescript-eslint/no-floating-promises` requires type information to work correctly on plain JS files. A new `tsconfig.lint.json` extends the existing `tsconfig.json` with `allowJs: true` and `include: ["lib/**/*.js", "index.js"]` so TypeScript can provide type inference for the ESLint rule without changing the build tsconfig.

XO's config is updated to point `parserOptions.project` at `tsconfig.lint.json` and enable the `@typescript-eslint/no-floating-promises` rule at `error` severity.

## Technical Considerations

### Part A: Pairing Script Design

**Prefix matching** is required because the actual test convention in this repo is one-to-many, not one-to-one. For example:
- `lib/stdio/handle.js` is covered by `test/stdio/handle-normal.js`, `test/stdio/handle-invalid.js`, `test/stdio/handle-options.js`
- `lib/transform/generator.js` is covered by `test/transform/generator-main.js`

A strict basename match would produce 36 false positives against the current codebase. The script checks for `test/<dir>/<basename>*.js` existence.

**Grandfathered files** (36 total — the full list is embedded in the script): every `lib/` file that currently has no matching `test/` file. New files NOT in this list that lack a test counterpart will cause CI failure. The grandfathered list is intentionally permanent — cleaning up existing untested files is out of scope.

**The `utils/` directory** (5 files) is entirely untested and is part of the grandfathered list. This is a known gap in the existing test coverage.

### Part B: JSDoc Scope — `index.js` vs. all `lib/`

AGENTS.md Rule 1 says "any function exported from `lib/`." Taken literally, this includes 200+ internal `export const` declarations used for tree-shaking across subdirectories. Requiring JSDoc on all of them would:
1. Be an enormous one-time authoring burden (~200+ blocks)
2. Force JSDoc on implementation details that have no user-facing documentation value

**Recommended scope: `index.js` only.** The 10–13 public API functions re-exposed through `index.js` are the functions that contributors actually interact with and that users see. The spirit of Rule 1 is ensuring the public API is documented, not that every internal module boundary has JSDoc.

This is implemented by adding an `overrides` block in the XO config targeting `index.js` with `jsdoc/require-jsdoc` enabled. The rule is not enabled globally.

XO config addition:
```json
"xo": {
  "overrides": [
    {
      "files": "index.js",
      "rules": {
        "jsdoc/require-jsdoc": ["error", {
          "require": {
            "FunctionExpression": true,
            "ArrowFunctionExpression": true,
            "FunctionDeclaration": true
          }
        }]
      }
    }
  ]
}
```

Note: `export { foo } from './lib/foo.js'` re-export statements do not have a JSDoc attachment point in the AST — these are passthrough re-exports and the rule will not flag them. Only direct `export const` or `export function` declarations in `index.js` will require JSDoc.

### Part C: Type-Aware Linting for Plain JS

`@typescript-eslint/no-floating-promises` requires the TypeScript compiler to analyze the file and infer return types. Without type information, the rule cannot know if a called function returns a `Promise`.

The current `tsconfig.json` only processes `index.d.ts`. A separate `tsconfig.lint.json` is needed:

```json
// tsconfig.lint.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "noImplicitAny": false
  },
  "include": ["lib/**/*.js", "index.js"]
}
```

Key choices:
- `checkJs: false` — prevents TypeScript from reporting type errors in JS files (the rule needs type *inference*, not type *checking*)
- `noImplicitAny: false` — prevents `any` warnings on untyped JS parameters
- `allowJs: true` — allows TypeScript to include `.js` files for type inference

XO config addition:
```json
"xo": {
  "parserOptions": {
    "project": "./tsconfig.lint.json"
  },
  "rules": {
    "@typescript-eslint/no-floating-promises": "error"
  }
}
```

> ⚠️ **Validation required:** Confirm that XO v0.60 passes `parserOptions.project` correctly to the ESLint `@typescript-eslint` parser. If not, a separate `eslint.config.js` override may be needed. See Deferred Planning Questions.

> ⚠️ **Existing patterns:** 7 files in `lib/` have existing `eslint-disable` comments. Audit these during Part C implementation to determine whether they are disabling floating-promise warnings intentionally (fire-and-forget IPC patterns) or are pre-existing suppressions that should be converted to real fixes.

### CI Integration (R5)

No new CI jobs. The `check-pairing` script is added as a step in the existing matrix job in `.github/workflows/main.yml`:

```yaml
- run: npm run lint          # already exists — now includes Rules 1 + 2
- run: npm run check-pairing # new — Rule 4
- run: npm run type          # already exists
- run: npm run unit          # already exists
```

## System-Wide Impact

- **Interaction graph:** `npm run lint` calls XO which calls ESLint with the updated config. Adding `parserOptions.project` causes ESLint to spin up a TypeScript language service for type-aware rules — this will increase `npm run lint` runtime. For a ~90-file project this is typically 2–5 seconds additional.
- **Error propagation:** CI failure on any of the three new checks blocks merge. No runtime behavior changes — this is purely static analysis.
- **State lifecycle risks:** None. All changes are to dev tooling only.
- **API surface parity:** Not applicable — no public API changes.
- **Integration test scenarios:** N/A — the checks themselves are the enforcement mechanism.

## Acceptance Criteria

- [ ] A PR that adds a public function to `index.js` without a JSDoc comment fails `npm run lint`
- [ ] A PR that contains an unawaited async call in `lib/` fails `npm run lint`
- [ ] A PR that adds a `lib/x/foo.js` file without a matching `test/x/foo*.js` file fails `npm run check-pairing` in CI
- [ ] `npm test` passes locally on the current codebase after implementation (no regressions, no suppressions)
- [ ] No new `eslint-disable` comments are added to existing `lib/` files as part of this work
- [ ] The 36 grandfathered lib/ files do not trigger pairing failures
- [ ] All ~13 public API exports in `index.js` have authored JSDoc blocks

## Implementation Phases

### Phase 1: Test Pairing Script (Part A) — Rule 4

**Deliverables:**
- `scripts/check-test-pairing.js` — pairing check with grandfathered allowlist
- `package.json` — add `"check-pairing"` script
- `.github/workflows/main.yml` — add `npm run check-pairing` step

**Grandfathered allowlist** (all 36 files — embed directly in the script):
```
arguments/command.js, arguments/file-url.js, arguments/options.js,
convert/add.js, io/contents.js, ipc/array.js, ipc/methods.js,
methods/main-sync.js, methods/parameters.js, resolve/all-async.js,
resolve/all-sync.js, resolve/exit-async.js, resolve/exit-sync.js,
resolve/wait-stream.js, stdio/handle-async.js, stdio/handle-sync.js,
stdio/handle.js, stdio/input-option.js, stdio/native.js, stdio/type.js,
terminate/kill.js, transform/generator.js, transform/normalize.js,
transform/object-mode.js, transform/run-async.js, transform/run-sync.js,
transform/split.js, utils/abort-signal.js, utils/deferred.js,
utils/max-listeners.js, utils/standard-stream.js, utils/uint-array.js,
verbose/custom.js, verbose/default.js, verbose/output.js, verbose/values.js
```

**Success criterion:** `npm run check-pairing` passes on the current codebase and fails when a lib/ test file is added without a counterpart.

---

### Phase 2: JSDoc Enforcement (Part B) — Rule 1

**Deliverables:**
- `package.json` (`xo.overrides`) — enable `jsdoc/require-jsdoc` on `index.js`
- `index.js` — JSDoc blocks authored for all public API exports

**JSDoc authoring scope** (~13 exports):
- `execa(file, arguments?, options?)` — primary async execution
- `execaSync(file, arguments?, options?)` — synchronous variant
- `execaCommand(command, options?)` — ⚠️ deprecated alias
- `execaCommandSync(command, options?)` — ⚠️ deprecated alias
- `execaNode(scriptPath, arguments?, options?)` — Node.js script execution
- `$(template, ...values)` — tagged template literal variant
- `parseCommandString(command)` — utility: parse command string into array
- `ExecaError` — error class for async failures
- `ExecaSyncError` — error class for sync failures
- `sendMessage(message, options?)` — IPC outbound
- `getOneMessage(options?)` — IPC receive one
- `getEachMessage(options?)` — IPC receive iterable
- `getCancelSignal()` — IPC cancel signal

**Success criterion:** `npm run lint` fails when a new function is added to `index.js` without JSDoc.

---

### Phase 3: Floating Promise Enforcement (Part C) — Rule 2

**Deliverables:**
- `tsconfig.lint.json` — new file for lint-only TypeScript config
- `package.json` (`xo.parserOptions`, `xo.rules`) — enable type-aware linting

**Validation steps during implementation:**
1. Verify `tsconfig.lint.json` allows XO/ESLint to process `lib/**/*.js` without type errors
2. Run `npm run lint` and audit any floating-promise violations — distinguish intentional fire-and-forget from genuine bugs
3. For intentional patterns (IPC callbacks), confirm whether an `// eslint-disable-next-line @typescript-eslint/no-floating-promises -- intentional fire-and-forget` comment is the right approach or whether the code can be refactored to avoid the pattern
4. Ensure `npm run lint` performance degradation is acceptable (< 10 seconds additional)

**Success criterion:** `npm run lint` fails when an unawaited async call is added to any `lib/` file.

## Dependencies & Risks

- **`eslint-plugin-jsdoc` is a new devDependency** — XO v0.60 does not bundle it. Must be added to `package.json` devDependencies before the lint rule can be configured.
- **XO v0.60 `parserOptions` compatibility** — uncertain whether XO 0.60 correctly passes `parserOptions.project` to the `@typescript-eslint` parser for JS files. If not, a fallback using `eslint-plugin-promise`'s `catch-or-return` rule (no type info required) is the backup for Phase 3.
- **Lint performance** — Type-aware linting starts a TypeScript language service. Monitor whether `npm run lint` time increases unacceptably on the 6-node CI matrix.
- **Intentional floating promises** — Some IPC and cleanup patterns in `lib/` may intentionally not await (fire-and-forget). These need per-line suppression comments rather than disabling the rule globally.
- **`eslint-plugin-jsdoc` version** — XO bundles jsdoc plugin internally. The `overrides` config format must match XO 0.60's expected structure. Verify by running `npm run lint` with the rule added before attempting Phase 2 JSDoc authoring.

## Outstanding Planning Questions

- **[Affects Phase 3]** Does XO v0.60 support `parserOptions.project` in the package.json xo config block? Check XO v0.60 changelog and README before implementing Phase 3.
- **[Affects Phase 3]** If `parserOptions.project` is not supported in XO's config, is a standalone `eslint.config.js` override possible, or should the fallback (`eslint-plugin-promise/catch-or-return`) be used instead?
- **[Affects Phase 3]** Does R3 cover `index.js` in addition to `lib/**/*.js`? The plan assumes yes — include `index.js` in `tsconfig.lint.json`.
- **[Affects Phase 2]** What format does XO v0.60 expect for `overrides`? Verify the `overrides` key is supported in XO's package.json config (it is an ESLint concept; XO may handle it differently).
- **[Affects Phase 2]** Add `eslint-plugin-jsdoc` to devDependencies — verify the version compatible with XO v0.60's internal ESLint 8.
- **[Affects Phase 1]** Recount the grandfathered allowlist using subdirectory-aware matching (`test/<dir>/<basename>*.js`) before committing the final list — the 36-file count used a simple basename diff and may need adjustment.
- **[Affects Phase 1]** The pairing script uses `globby` for file matching — confirm `globby` is already a dependency or available, or use Node's built-in `fs.glob` (available in Node 22+, but minimum is 18.19).

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-automate-pr-rules-requirements.md](../brainstorms/2026-03-24-automate-pr-rules-requirements.md)
  Key decisions carried forward: (1) JSDoc on public API only — not all internal exports; (2) Rule 3 excluded; (3) CI-only enforcement, no pre-commit hooks

### Internal References

- XO config: [`package.json:99-104`](../../package.json#L99)
- CI workflow: [`.github/workflows/main.yml`](../../.github/workflows/main.yml)
- tsconfig: [`tsconfig.json`](../../tsconfig.json)
- Public API surface: [`index.js`](../../index.js)
- AGENTS.md Rules 1, 2, 4: [`AGENTS.md`](../../AGENTS.md)

### Grandfathered Files Reference

Full list of 36 existing `lib/` files with no test/ counterpart (for the pairing script allowlist):

```
arguments/command.js        ipc/methods.js              terminate/kill.js
arguments/file-url.js       methods/main-sync.js        transform/generator.js
arguments/options.js        methods/parameters.js       transform/normalize.js
convert/add.js              resolve/all-async.js        transform/object-mode.js
io/contents.js              resolve/all-sync.js         transform/run-async.js
ipc/array.js                resolve/exit-async.js       transform/run-sync.js
                            resolve/exit-sync.js        transform/split.js
                            resolve/wait-stream.js      utils/abort-signal.js
                            stdio/handle-async.js       utils/deferred.js
                            stdio/handle-sync.js        utils/max-listeners.js
                            stdio/handle.js             utils/standard-stream.js
                            stdio/input-option.js       utils/uint-array.js
                            stdio/native.js             verbose/custom.js
                            stdio/type.js               verbose/default.js
                                                        verbose/output.js
                                                        verbose/values.js
```
