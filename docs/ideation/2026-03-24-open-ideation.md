---
date: 2026-03-24
topic: open-ideation
focus: open-ended
---

# Ideation: Execa Fork Improvements

## Codebase Context

- **Language/runtime:** Plain JavaScript source in `lib/` (not compiled TypeScript), separate type declarations maintained by hand in `types/` and `index.d.ts`
- **Test framework:** AVA, 1:1 mirroring of `lib/` structure required under `test/`; type-level tests in `test-d/`
- **Documentation:** 20+ topic-based markdown files in `docs/`, plus `readme.md` as the primary API reference
- **Library shape:** 13 subdirectories (`arguments`, `convert`, `io`, `ipc`, `methods`, `pipe`, `resolve`, `return`, `stdio`, `terminate`, `transform`, `utils`, `verbose`), plus 11+ `*-async.js`/`*-sync.js` paired files
- **Pain points:**
  - Four PR rules (JSDoc, no floating promises, README sync, test file pairing) enforced manually — no linting automation
  - `types/` maintained in parallel with `lib/` — can silently drift
  - `research/` and `research-claude/` directories have no policy or lifecycle
  - `AGENTS.md` describes source files as `.ts` but source is `.js`
  - No `docs/solutions/` institutional knowledge base
- **Leverage points:** verbose subsystem already produces rich structured `VerboseObject` data; async/sync split in 11+ file pairs; deprecated `execaCommand` surface still present

## Ranked Ideas

### 1. Automate All Four PR Rules via ESLint + CI
**Description:** Convert the four manual AGENTS.md rules into machine-enforced checks: `eslint-plugin-jsdoc` (Rule 1), `@typescript-eslint/no-floating-promises` (Rule 2), a git-diff script asserting `readme.md` was touched when option files changed (Rule 3), and a filesystem pairing check for lib/test mirroring (Rule 4). Wire all into a required CI job and a `lint-staged` pre-commit hook.

**Rationale:** Every manual review cycle that catches a rule violation costs an author→reviewer round-trip. Automating all four converts a probabilistic gate into a hard gate permanently. The rules are already precisely specified — they're just not wired to tooling.

**Downsides:** Adds ESLint plugin dependencies. The README-sync check requires care to avoid false positives (e.g., touching `options.js` in a refactor that isn't an API addition).

**Confidence:** 90%
**Complexity:** Low–Medium
**Status:** Explored — brainstormed 2026-03-24, requirements at `docs/brainstorms/2026-03-24-automate-pr-rules-requirements.md`

---

### 2. Verbose Subsystem as First-Class Structured Event Stream
**Description:** Add a `subprocess.verboseStream()` method (or `verboseEvents` option) that exposes an `AsyncIterable<VerboseObject>` — the same rich structured data `lib/verbose/` already constructs — before it gets formatted into colored stderr text. The human-readable output becomes one subscriber; callers can add their own (Pino, Winston, OpenTelemetry spans, CI annotation systems).

**Rationale:** `VerboseObject` is already fully typed with command, timestamp, type, exitCode, signal, piped, result. All that richness is discarded into a formatted string. Surfacing it as a pull-based stream transforms verbose mode from a debugging toggle into an extension point — any observability tool becomes a first-class citizen without string-parsing hacks.

**Downsides:** API design requires care — the `AsyncIterable` must be non-blocking relative to process execution. Buffering strategy for high-volume output streams needs thought.

**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

---

### 3. JSDoc as Single Source of Truth — Complete API Governance Automation
**Description:** A synthesized improvement collapsing three pain points: (a) author JSDoc on all `lib/` exports (satisfying Rule 1), (b) configure `tsc` with `allowJs + checkJs + declaration` to generate `types/` from that JSDoc rather than hand-maintaining it, and (c) write a doc-extraction script that pulls `@param` descriptions to regenerate option tables in `readme.md` (automating Rule 3). Change a function signature once; types and README stay correct automatically.

**Rationale:** The current split — JS source + hand-maintained `types/` + hand-maintained `readme.md` — is three artifacts that must stay in sync manually. This collapses it to one. Rules 1 and 3 become side-effects of normal development rather than review checklist items.

**Downsides:** Significant upfront migration — every `lib/` export needs JSDoc authored. The `tsc` JSDoc inference is imperfect for complex generics. Highest-effort idea on the list.

**Confidence:** 65%
**Complexity:** High
**Status:** Unexplored

---

### 4. Unify Async and Sync Execution Paths
**Description:** Collapse the 11+ parallel `*-async.js`/`*-sync.js` file pairs into a single execution core where sync is a degenerate case (no AbortController, no pipe, no IPC) derived from shared pre/post processing logic. Affected pairs: `output-async/sync`, `handle-async/sync`, `run-async/sync`, `exit-async/sync`, `all-async/sync`, and more across `io/`, `resolve/`, `transform/`, `methods/`.

**Rationale:** Every bug fix or new feature must currently be applied twice. The PR review rules don't enforce parity between paths, so they silently diverge. Convergence halves the maintenance surface and eliminates the class of "works async but not sync" bugs.

**Downsides:** High-risk refactor. The async path uses Promises and event-driven I/O; the sync path uses `spawnSync`, which is fundamentally different at the OS level. Some duplication is load-bearing. A bad merge could introduce subtle correctness regressions.

**Confidence:** 70%
**Complexity:** High
**Status:** Unexplored

---

### 5. Built-In Retry API
**Description:** Add a `retry` option accepting `{ times, delay, shouldRetry }` that automatically re-spawns the subprocess on failure before rejecting. Expose `retryCount` on the result/error object. Integrate with the existing verbose system so retry attempts are logged, and respect `cancelSignal` so retries abort cleanly.

**Rationale:** Retry-on-failure is one of the most commonly reimplemented patterns on top of execa. Every user implementation duplicates the same `try/catch` + re-run loop. Built-in retry also composes cleanly with verbose logging and pipe chains in ways that ad-hoc wrappers cannot.

**Downsides:** The option surface (`shouldRetry` callback, delay strategies) can balloon if not scoped tightly. Retry + pipe chains + `cancelSignal` have non-obvious interaction semantics that need careful specification.

**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

---

### 6. Executable Doctests — Examples as AVA Tests
**Description:** Replace key code examples in `docs/` and `readme.md` with literate test files (`test/docs/pipe.js`, `test/docs/errors.js`, etc.) that import from the library and assert documented behavior. When a documented example breaks, the AVA test suite fails. Run alongside the existing test suite.

**Rationale:** The manual README sync rule (Rule 3) exists entirely because documentation is disconnected from code. Executable doctests invert the relationship: the test suite becomes the enforcement mechanism, and human review of doc sync becomes unnecessary. Each example written once pays a permanent correctness dividend.

**Downsides:** Docs are currently narrative prose — not all examples are directly convertible to assertions. Some examples (verbose output formatting, signal handling on Windows) are environment-dependent and harder to assert deterministically.

**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

---

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Fix AGENTS.md `.ts`→`.js` inaccuracy | 2-line edit, not an improvement idea |
| 2 | Auto-generate JSDoc from `types/` | Backwards — `types/` are derived from source, not the authority |
| 3 | Zod schema for result objects | Runtime dependency for value TypeScript already delivers to 99% of callers |
| 4 | Subprocess capability probing over IPC | Niche monorepo use case; high complexity for narrow applicability |
| 5 | Cross-platform test matrix tooling | GitHub CI already covers this; local sim has minimal marginal value |
| 6 | Cross-reference index (option→docs) | Absorbed by idea #3 (API governance automation) |
| 7 | Replace README sync with doc-extraction | Absorbed by idea #3 (API governance automation) |
| 8 | Test fixture inventory | Absorbed by idea #6 (executable doctests) |
| 9 | Shared execution graph (replace AbortController) | Internal refactor with unclear user benefit; belongs inside idea #4 if pursued |
| 10 | DAG-based subprocess pipeline builder | Out of scope for a library fork; ambiguous upstream intent |
| 11 | Native OpenTelemetry integration | Better as a third-party package once idea #2 (structured verbose) lands |
| 12 | `docs/solutions/` how-to guides | Good but low leverage — absorbed by idea #6 (executable doctests) |
| 13 | `research/` ADR system | Valuable but lower leverage than the ranked survivors |
| 14 | API snapshot test for breaking changes | Solid but absorbed into idea #1 (PR rule automation) |
| 15 | Replace 1:1 test mirroring with behavior-centric tests | Controversial in a fork; too risky without upstream buy-in |
| 16 | Time-travel debugging / replay traces | Too ambitious relative to fork scope; best explored as a standalone tool |

## Session Log
- 2026-03-24: Initial ideation — 40 raw candidates generated across 5 frames, 3 cross-cutting syntheses added, 6 survivors after two-pass adversarial filtering
- 2026-03-24: Brainstormed idea #1 (Automate PR Rules) → requirements doc at `docs/brainstorms/2026-03-24-automate-pr-rules-requirements.md`
