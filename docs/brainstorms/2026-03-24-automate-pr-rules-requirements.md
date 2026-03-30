---
date: 2026-03-24
topic: automate-pr-rules
---

# Automate PR Rule Enforcement

## Problem Frame

AGENTS.md defines four PR review rules enforced entirely by human code reviewers. Violations are caught only at review time, costing an author→reviewer round-trip per missed rule. Contributors have no feedback loop before opening a PR. Rule 3 (README sync) is excluded from this work — it is better addressed as part of JSDoc-as-single-source-of-truth (#3 from ideation).

## Requirements

- **R1.** `npm run lint` must fail if any function exported from `lib/` is missing a JSDoc block.
- **R2.** JSDoc blocks must be authored for all currently exported functions in `lib/` as part of this work, so lint passes on day one with no suppressions.
- **R3.** `npm run lint` must fail if any `async` function call in `lib/` produces a floating promise (i.e., a Promise that is neither awaited nor chained with `.catch()`).
- **R4.** CI must fail if any file added under `lib/` does not have a corresponding file under `test/` with the same relative path (e.g., `lib/io/output.js` requires `test/io/output.js`).
- **R5.** All three checks run within the existing CI workflow (`.github/workflows/main.yml`) — no new CI jobs are added. R1 and R3 are enforced via `npm run lint`; R4 via a script invoked in CI.

## Success Criteria

- A PR that adds a public function without a JSDoc comment fails CI automatically.
- A PR that contains an unawaited async call fails CI automatically.
- A PR that adds a `lib/` file without a matching `test/` file fails CI automatically.
- `npm test` passes locally on the current codebase after this work is complete.
- No ESLint suppressions (`eslint-disable` comments) are added to existing `lib/` files.

## Scope Boundaries

- **Rule 3 (README sync) is excluded.** Automating README sync reliably requires JSDoc-as-source-of-truth infrastructure (ideation idea #3) and is deferred.
- **No pre-commit hooks.** Enforcement is CI-only. Contributors are not required to install local hooks.
- **Rule 4 checks file existence only** — it does not assert test content or coverage.
- Rule 4 applies to new files; existing `lib/` files without `test/` counterparts are out of scope unless they are missing (in which case adding the test file is a separate cleanup task).

## Key Decisions

- **Write JSDoc for all existing exports now, not gradually.** Avoids lint suppressions and sets a clean baseline. Accepted over a gradual warn→error rollout because suppressions create long-term noise and a warm-up period delays the actual enforcement value.
- **Rule 3 excluded.** A git-diff heuristic for README sync is too brittle and prone to false positives. The right fix is JSDoc-driven doc generation (ideation #3), not a fragile diff check.
- **CI-only enforcement.** `npm run lint` already runs in CI and locally via `npm test`. Pre-commit hooks add contributor setup friction for marginal benefit.

## Dependencies / Assumptions

- `tsconfig.json` currently only covers `index.d.ts`. Type-aware linting for R3 (`no-floating-promises`) may require extending tsconfig to include `lib/**/*.js` with `allowJs: true` and `checkJs: true`. Exact configuration is a planning question.
- XO v0.60 is the linting tool. Plugin additions must be compatible with XO's ESLint wrapper API.

## Outstanding Questions

### Resolve Before Planning
_(none)_

### Deferred to Planning

- **[Affects R3][Technical]** Can `@typescript-eslint/no-floating-promises` run on plain JS files with the current XO/tsconfig setup, or does it require a separate tsconfig for lint? Validate during planning.
- **[Affects R3][Needs research]** Is there a type-information-free alternative (e.g., `eslint-plugin-promise`) that catches the same patterns reliably in plain JS without requiring `allowJs + checkJs`?
- **[Affects R4][Technical]** Are there existing `lib/` files without a corresponding `test/` file that should be grandfathered? Confirm during planning by running the pairing check against current state.
- **[Affects R1][Technical]** Which XO/eslint-plugin-jsdoc configuration correctly restricts JSDoc enforcement to exported functions only (not internal helpers)?

## Next Steps
→ `/ce:plan` for structured implementation planning
