# Execa Codebase Research Document

## Summary

Execa v9.6.1 is a Node.js library (ESM-only, requires `^18.19.0 || >=20.5.0`) for running subprocesses with a human-friendly API. It wraps Node.js `child_process.spawn` / `child_process.spawnSync` and exposes six public method families: `execa`, `$`, `execaNode`, `execaSync`, `$.sync`/`$.s`, plus four IPC helpers (`sendMessage`, `getOneMessage`, `getEachMessage`, `getCancelSignal`). All async return values are a dual `Subprocess + Promise` object. The library is organized into nine internal subsystems under `lib/`: `methods`, `arguments`, `stdio`, `io`, `transform`, `ipc`, `pipe`, `resolve`, `return`, `terminate`, `verbose`, `convert`, and `utils`. TypeScript declarations mirror the structure under `types/`.

---

## 1. Public Entry Point

**File:** `index.js` (lines 1–28)

All six exported methods are built from a single factory function `createExeca`:

```
execa        = createExeca(() => ({}))
execaSync    = createExeca(() => ({isSync: true}))
execaCommand = createExeca(mapCommandAsync)      // deprecated alias
execaCommandSync = createExeca(mapCommandSync)   // deprecated alias
execaNode    = createExeca(mapNode)
$            = createExeca(mapScriptAsync, {}, deepScriptOptions, setScriptSync)
```

IPC helpers (`sendMessage`, `getOneMessage`, `getEachMessage`, `getCancelSignal`) come from `lib/ipc/methods.js:getIpcExport()`, which detects whether the current process has an IPC channel (`process.channel !== undefined`).

---

## 2. Method Factory (`lib/methods/`)

### `create.js` — `createExeca(mapArguments, boundOptions, deepOptions, setBoundExeca)`

`lib/methods/create.js:13-65`

The factory wraps every exported method with three features:
1. **Options binding** — if the first arg is a plain object, returns a new bound instance.
2. **Template string syntax** — if the first arg passes `isTemplateString` check, delegates to `parseTemplates`.
3. **Optional args normalization** — calls `normalizeParameters` then the method-specific `mapArguments` hook.

After normalization, dispatches to either `execaCoreAsync` or `execaCoreSync` based on `isSync`.

### `template.js` — Template string parsing

`lib/methods/template.js:1-153`

`parseTemplates` iterates tagged-template segments. Whitespace (space/tab/CR/LF) in the raw string splits tokens into separate arguments. Backslash-escaped whitespace is kept literal. Supported expression types: `string`, `number`, a prior `Result` object (uses `result.stdout`). `ChildProcess` and plain `Promise` instances throw an explanatory `TypeError`.

### `script.js` — `$` method specifics

`lib/methods/script.js:1-23`

`$` adds `stdin: 'inherit'` (when no input/stdio overrides) and `preferLocal: true`. `deepScriptOptions` (`{preferLocal: true}`) propagates to piped destinations. `setScriptSync` adds `$.sync` / `$.s` aliases.

### `node.js` — `execaNode` specifics

`lib/methods/node.js` sets `node: true`. `lib/arguments/options.js:handleNodeOption` converts this into `nodePath` (defaults to `process.execPath`) and prepends node CLI flags.

### `promise.js` — Subprocess-as-Promise mixin

`lib/methods/promise.js:1-15`

Binds `then`, `catch`, `finally` from the native Promise prototype directly onto the `ChildProcess` instance, making it awaitable while still being a `ChildProcess`.

### `bind.js` — Options merging

`lib/methods/bind.js` implements `mergeOptions` for chained `execa(opts1)(opts2)` calls.

---

## 3. Async Execution Core (`lib/methods/main-async.js`)

`lib/methods/main-async.js:25-194`

**Entry:** `execaCoreAsync(rawFile, rawArguments, rawOptions, createNested)`

**Step-by-step flow:**

1. `handleAsyncArguments` — runs `handleCommand` (verbose setup, command string, start time), `normalizeOptions`, `handleAsyncOptions` (renames `timeout` → `timeoutDuration`; rejects if `signal` is used directly), then `handleStdioAsync` (builds `fileDescriptors`).
2. `spawnSubprocessAsync` — calls `child_process.spawn`. On error, routes to `handleEarlyError`. On success:
   - Creates an `AbortController` with unlimited listeners.
   - Calls `pipeOutputAsync` to wire internal stdio streams.
   - Calls `cleanupOnExit` to register the `signal-exit` handler.
   - Monkey-patches `subprocess.kill` → `subprocessKill`.
   - Sets `subprocess.all` via `makeAllStream`.
   - Calls `addConvertedStreams` (`.readable()`, `.writable()`, `.duplex()`, `.iterable()`, `[Symbol.asyncIterator]`).
   - Calls `addIpcMethods`.
   - Creates the async `handlePromise`.
3. `mergePromise` binds `then/catch/finally` onto the subprocess.
4. Stores `{options, fileDescriptors}` in `SUBPROCESS_OPTIONS` WeakMap.
5. Returns the subprocess immediately (synchronously), before the process even starts.

**`handlePromise`** (`lib/methods/main-async.js:129-164`) is the async half:

- Awaits `waitForSubprocessResult` which races: successful exit + all stream data + IPC output vs. timeout / cancel / internal error / subprocess `error` event.
- Calls `controller.abort()` to clean up all registered listeners.
- Applies `stripNewline` to stdio and all results.
- Calls `makeError` or `makeSuccessResult` then `handleResult` (which may throw or return).

---

## 4. Sync Execution Core (`lib/methods/main-sync.js`)

`lib/methods/main-sync.js:1-163`

**Entry:** `execaCoreSync(rawFile, rawArguments, rawOptions)`

Validates sync-incompatible options early (`ipcInput`, `ipc: true`, `detached: true`, `cancelSignal`). Calls `child_process.spawnSync` with `encoding: 'buffer'` (Execa handles encoding itself). Processes output through `transformOutputSync` (sync generators), then `getAllSync`, then `stripNewline`.

Key difference from async: no piping setup, no AbortController, no IPC. Returns a plain result object (not a subprocess).

---

## 5. Argument Normalization (`lib/arguments/`)

### `options.js` — `normalizeOptions`

`lib/arguments/options.js:18-100`

- Copies options to a `null`-prototype object to block prototype-pollution.
- Resolves `cwd` via `normalizeCwd`.
- Runs `handleNodeOption` (prepends node executable).
- Passes through `cross-spawn._parse` for Windows path normalization.
- Expands fd-specific option arrays via `normalizeFdSpecificOptions`.
- Applies defaults for `extendEnv`, `preferLocal`, `encoding`, `reject`, `cleanup`, `all`, `windowsHide`, `killSignal`, `forceKillAfterDelay`, `gracefulCancel`, `ipc`, `serialization`.
- Builds `env` with optional `npm-run-path` injection when `preferLocal` or `node` is set.
- On Windows, prepends `/q` to `cmd.exe` arguments (issue #116).

### `specific.js` — Per-fd option arrays

`lib/arguments/specific.js` handles options like `verbose`, `lines`, `stripFinalNewline`, `buffer`, `maxBuffer` which can differ per file descriptor by accepting either a scalar or a `[stdoutValue, stderrValue]` tuple.

### `command.js` — Verbose + command string

`lib/arguments/command.js:8-20`

Computes `result.command` and `result.escapedCommand`, captures `startTime`, and calls `logCommand` to emit the verbose `'command'` event line before spawning.

### `escape.js` — Command string building

`joinCommand` and `escapeLines` build the human-readable command string used in results and verbose output.

---

## 6. Stdio Handling (`lib/stdio/`)

### Type detection (`type.js`)

`lib/stdio/type.js:6-173`

`getStdioItemType` classifies a single stdio value into one of: `asyncGenerator`, `generator`, `fileUrl`, `filePath`, `webStream`, `native`, `uint8Array`, `asyncIterable`, `iterable`, `webTransform`, `duplex`.

Exported type sets:
- `TRANSFORM_TYPES = {'generator', 'asyncGenerator', 'duplex', 'webTransform'}` — types that replace `subprocess.stdio[n]`.
- `FILE_TYPES = {'fileUrl', 'filePath', 'fileNumber'}`.
- `SPECIAL_DUPLICATE_TYPES`, `FORBID_DUPLICATE_TYPES` — duplication rules.

### `handle.js` / `handle-async.js` / `handle-sync.js`

`lib/stdio/handle-async.js:1-52`

`handleStdioAsync` creates the `fileDescriptors` array used throughout async execution. For each fd/option value it resolves a `stream` property:

| Type | Async stream |
|---|---|
| `generator` / `asyncGenerator` | `generatorToStream(...)` → `Transform` |
| `fileUrl` input | `createReadStream(value)` |
| `fileUrl` output | `createWriteStream(value)` |
| `filePath` output | `createWriteStream(file, append ? {flags:'a'} : {})` |
| `webStream` input | `Readable.fromWeb(value)` |
| `webStream` output | `Writable.fromWeb(value)` |
| `iterable` / `asyncIterable` / `string` / `uint8Array` input | `Readable.from(value)` |
| `webTransform` | `Duplex.fromWeb(transform, {objectMode})` |
| `duplex` | direct `transform` property |
| `native` | no stream (Node.js handles natively) |

---

## 7. Transform Pipeline (`lib/transform/`)

### `generator.js`

`lib/transform/generator.js:38-107`

`generatorToStream` converts a user generator (sync or async) into a Node.js `Transform` stream. Internally chains six "internal generators" in order:

1. `getValidateTransformInput` — validates chunk type matches `writableObjectMode`.
2. `getEncodingTransformGenerator` — converts `Buffer` → `string`/`Uint8Array` per encoding.
3. `getSplitLinesGenerator` — splits by newline boundaries.
4. User's `{transform, final}`.
5. `getValidateTransformReturn` — validates yielded values match `readableObjectMode`.
6. `getAppendNewlineGenerator` — re-appends newlines when `preserveNewlines` is true.

`runGeneratorsSync` applies the same chain iteratively in sync mode.

### Object mode

`lib/transform/object-mode.js` and `lib/transform/normalize.js` handle `{objectMode: true}` generators, which allow yielding arbitrary JS values.

---

## 8. IPC (`lib/ipc/`)

`lib/ipc/methods.js:1-49`

`addIpcMethods(subprocess, {ipc})` attaches `sendMessage`, `getOneMessage`, `getEachMessage` to the subprocess instance. The same factory `getIpcMethods` is used in `getIpcExport()` for the child-side API exported at the top level.

Each method receives `{anyProcess, channel, isSubprocess, ipc}` via bind-partial application.

### `send.js` — `sendMessage`

`lib/ipc/send.js:15-91`

Promisifies `process.send` via `util.promisify` (memoized in a `WeakMap`). Supports `{strict: true}` option which waits for an acknowledgement from the receiver (`lib/ipc/strict.js`).

### `get-one.js` / `get-each.js`

Single-message and async-iterable interfaces over the `'message'` event. Both support `{reference: boolean}` to control whether waiting keeps the event loop alive (`lib/ipc/reference.js`), and `{filter: fn}` for single-message.

### `graceful.js` — `getCancelSignal`

Exposes an `AbortSignal` inside the subprocess that mirrors the parent's `cancelSignal`. Used when `gracefulCancel: true`.

### `buffer-messages.js`

Buffers all incoming IPC messages into `result.ipcOutput` when `buffer: true`.

---

## 9. Piping (`lib/pipe/`)

### `setup.js`

`lib/pipe/setup.js:9-72`

`pipeToSubprocess` is bound as `subprocess.pipe`. Supports three call forms (file + args, template string, or already-spawned subprocess). Allows chaining: the returned promise also has a `.pipe` property. Uses `Promise.race` between `waitForBothSubprocesses` (both succeed) and `unpipeOnAbort` (AbortSignal fires).

### `pipe-arguments.js`

`lib/pipe/pipe-arguments.js` resolves the destination subprocess from any of the three call forms, extracts `from` / `to` fd options (`pipeOptions.from`, `pipeOptions.to`).

### `streaming.js`

`lib/pipe/streaming.js` calls Node.js `stream.pipeline` between the source and destination streams.

### `abort.js`

Wires `pipeOptions.unpipeSignal` to detach the pipeline when the AbortSignal fires.

---

## 10. Result Waiting (`lib/resolve/`)

### `wait-subprocess.js`

`lib/resolve/wait-subprocess.js:17-146`

Central async resolution logic. Uses `Promise.race` of:

| Race participant | File |
|---|---|
| Happy path: exit + stdio + all + IPC | `exit-async.js`, `stdio.js`, `all-async.js`, `buffer-messages.js` |
| Internal error (kill with Error) | `utils/deferred.js` |
| subprocess `error` event | inline `throwOnSubprocessError` |
| Timeout | `terminate/timeout.js` |
| Cancel signal | `terminate/cancel.js` |
| Graceful cancel | `terminate/graceful.js` |

On error, falls back to `getBufferedData` / `getBufferedIpcOutput` to collect whatever output was captured.

### `stdio.js` / `all-async.js`

Wait for each stdio stream using `get-stream` (buffered collection) or just for end/close events when `buffer: false`.

---

## 11. Termination (`lib/terminate/`)

### `kill.js`

`lib/terminate/kill.js:25-93`

Monkey-patches `subprocess.kill()` to:
- Accept `(error)` or `(signal)` or `(signal, error)` argument forms.
- On `kill(error)`, immediately rejects the internal deferred (surfaces as `error.cause`).
- After sending the kill signal, starts a `forceKillAfterDelay` timer (default 5000 ms) that sends `SIGKILL` if the process has not yet exited. Sets `context.isForcefullyTerminated = true`.

`DEFAULT_FORCE_KILL_TIMEOUT = 5000` (`lib/terminate/kill.js:22`).

### `timeout.js`

`lib/terminate/timeout.js` — `throwOnTimeout` races a `setTimeout` promise. On expiry, kills with `killSignal`, sets `context.terminationReason = 'timeout'`.

### `cancel.js`

`lib/terminate/cancel.js` — `throwOnCancel` listens to `cancelSignal.abort`. Sets `context.terminationReason = 'cancel'`, sends `killSignal`.

### `graceful.js`

`lib/terminate/graceful.js` — when `gracefulCancel: true`, sends the AbortSignal via IPC to the subprocess instead of killing it. Sets `context.terminationReason = 'gracefulCancel'`.

### `cleanup.js`

`lib/terminate/cleanup.js` — registers via `signal-exit` to kill the subprocess when the parent process exits (controlled by `cleanup: true` option).

### `signal.js`

`lib/terminate/signal.js` — `getSignalDescription` maps signal names to human-readable strings using `human-signals`. `normalizeKillSignal` validates the `killSignal` option.

---

## 12. Result Object (`lib/return/`)

### `result.js`

`lib/return/result.js:1-186`

Three constructors:

- `makeSuccessResult` — produces `{command, escapedCommand, cwd, durationMs, failed: false, timedOut: false, isCanceled: false, isGracefullyCanceled: false, isTerminated: false, isMaxBuffer: false, isForcefullyTerminated: false, exitCode: 0, stdout, stderr, all, stdio, ipcOutput, pipedFrom: []}`.
- `makeEarlyError` — delegates to `makeError` with all termination flags `false` and empty stdio.
- `makeError` — builds full error object with all boolean flags, normalizes `null` exit codes/signals to `undefined`, computes `signalDescription`, constructs error message via `createMessages`, then calls `getFinalError` to get an `ExecaError` / `ExecaSyncError` instance and assigns all properties via `Object.assign`.

`omitUndefinedProperties` strips `undefined` values from the result so TypeScript narrowing works correctly.

### `final-error.js`

`lib/return/final-error.js` — `getFinalError` instantiates either `ExecaError` (async) or `ExecaSyncError` (sync), both extending `Error`. `isErrorInstance` helper checks `instanceof Error`.

### `message.js`

`lib/return/message.js` — `createMessages` builds `shortMessage` (no subprocess output), `originalMessage` (raw underlying error), and `message` (full message with output appended, formatted by `formatErrorMessage`).

### `reject.js`

`lib/return/reject.js` — `handleResult` either throws the result (if `failed` and `reject: true`) or returns it.

---

## 13. Verbose Logging (`lib/verbose/`)

`lib/verbose/log.js:14-54`

`verboseLog({type, verboseMessage, fdNumber, verboseInfo, result})` is called at multiple lifecycle points:

| Call site | Type | File |
|---|---|---|
| Before spawn | `'command'` | `verbose/start.js` |
| stdout/stderr output lines | `'output'` | `verbose/output.js` |
| IPC messages | `'ipc'` | `verbose/ipc.js` |
| On error | `'error'` | `verbose/error.js` |
| On completion (success or failure) | `'duration'` | `verbose/complete.js` |

All output goes to `console.warn` (i.e. stderr). The default formatter (`verbose/default.js`) produces:

```
[HH:MM:SS.mmm] [commandId] <icon> <message>
```

Icons: `$` (unpiped command), `|` (piped command), ` ` (output), `*` (IPC), `✔`/`✖`/`⚠` (duration/error). Colors via `yoctocolors`.

A user function can be passed as `verbose` to fully customize this. The function receives `(message: string, verboseObject: VerboseObject)` and returns a `string | undefined` (undefined suppresses the line). `lib/verbose/custom.js` applies the function per-line.

`verboseObject` properties: `type`, `escapedCommand`, `commandId` (incrementing string), `timestamp` (Date), `piped` (boolean), `result` (on error/duration), `options`.

---

## 14. Stream Conversion (`lib/convert/`)

`lib/convert/add.js:8-15`

`addConvertedStreams` attaches four methods to the subprocess:

- `subprocess.readable(readableOptions?)` → Node.js `Readable` (`lib/convert/readable.js`)
- `subprocess.writable(writableOptions?)` → Node.js `Writable` (`lib/convert/writable.js`)
- `subprocess.duplex(duplexOptions?)` → Node.js `Duplex` (`lib/convert/duplex.js`)
- `subprocess.iterable(readableOptions?)` → `AsyncIterable` (`lib/convert/iterable.js`)
- `subprocess[Symbol.asyncIterator]` → same as `iterable` with `{}` options

All accept a `from`/`to` option to select the fd, a `binary` flag, and `preserveNewlines`. `lib/convert/concurrent.js` enforces that only one of readable/writable/duplex can be active per fd at a time.

---

## 15. I/O Utilities (`lib/io/`)

| File | Purpose |
|---|---|
| `output-async.js` | `pipeOutputAsync` — wires subprocess stdio to internal streams (transforms, file streams, etc.) using `stream.pipeline` |
| `output-sync.js` | `transformOutputSync` — applies sync transforms to spawnSync output buffers |
| `input-sync.js` | `addInputOptionsSync` — converts string/Uint8Array/iterable inputs into buffers for `spawnSync` |
| `contents.js` | `getBufferedData` — safe buffer drain on error (prevents memory leaks) |
| `max-buffer.js` | `getMaxBufferSync` — converts `maxBuffer` to byte count for `spawnSync` |
| `strip-newline.js` | `stripNewline` — removes final newline from string results unless `stripFinalNewline: false` |
| `iterate.js` | helpers for async line iteration |

---

## 16. Utilities (`lib/utils/`)

| File | Purpose |
|---|---|
| `deferred.js` | `createDeferred()` — a `{promise, resolve, reject}` object used for `onInternalError` |
| `abort-signal.js` | helpers to wire AbortSignals |
| `max-listeners.js` | `setMaxListeners` wrapper |
| `standard-stream.js` | `isStandardStream` — checks if a stream is `process.stdin/stdout/stderr` |
| `uint-array.js` | `isUint8Array`, `uint8ArrayToString` |

---

## 17. TypeScript Declarations (`types/` and `index.d.ts`)

`index.d.ts` is the single entry type declaration; it re-exports from `types/`. The type hierarchy mirrors the lib structure:

```
types/
  arguments/     — Options, SyncOptions, encoding types, fd-specific option arrays
  methods/       — ExecaMethod, ExecaScriptMethod, ExecaNodeMethod, ExecaSyncMethod signatures
  return/        — Result, SyncResult, ExecaError, ExecaSyncError
  stdio/         — StdinOption, StdoutStderrOption, their Sync variants
  subprocess/    — Subprocess, SubprocessStdio, SubprocessAll
  transform/     — normalize/object-mode helpers
  convert.d.ts   — Readable/Writable/Duplex/Iterable conversion types
  ipc.d.ts       — IPC method types, Message type
  pipe.d.ts      — PipeOptions, ResultPromise
  verbose.d.ts   — VerboseObject, SyncVerboseObject
  utils.d.ts     — shared helpers
```

---

## 18. Cross-Component Data Flow

```
User calls execa(file, args, opts)
        │
        ▼
createExeca / callBoundExeca     [lib/methods/create.js]
  │  parses template / normalizes args / merges bound options
  │
  ▼
execaCoreAsync                   [lib/methods/main-async.js]
  │
  ├─ handleCommand               [lib/arguments/command.js]
  │    └─ logCommand (verbose 'command')
  │
  ├─ normalizeOptions            [lib/arguments/options.js]
  │    └─ cross-spawn._parse (Windows path normalization)
  │
  ├─ handleStdioAsync            [lib/stdio/handle-async.js]
  │    └─ getStdioItemType × each fd value  [lib/stdio/type.js]
  │         └─ generatorToStream / Readable.from / createReadStream / …
  │
  ├─ child_process.spawn         [Node.js built-in]
  │
  ├─ pipeOutputAsync             [lib/io/output-async.js]
  ├─ cleanupOnExit               [lib/terminate/cleanup.js]
  ├─ subprocessKill (patch)      [lib/terminate/kill.js]
  ├─ makeAllStream               [lib/resolve/all-async.js]
  ├─ addConvertedStreams          [lib/convert/add.js]
  ├─ addIpcMethods               [lib/ipc/methods.js]
  ├─ mergePromise                [lib/methods/promise.js]
  │
  └─ returns subprocess to user immediately
        │
        ▼  (async, in background)
handlePromise
  │
  ├─ waitForSubprocessResult     [lib/resolve/wait-subprocess.js]
  │    races: exit/stdio/ipc vs timeout/cancel/error
  │
  ├─ stripNewline                [lib/io/strip-newline.js]
  │
  ├─ makeSuccessResult / makeError  [lib/return/result.js]
  │
  └─ handleResult (throw or return)  [lib/return/reject.js]
        │
        └─ verbose 'duration'/'error'  [lib/verbose/complete.js, error.js]
```

---

## 19. Dependencies

| Package | Role |
|---|---|
| `cross-spawn` | Windows-compatible `spawn` argument normalization |
| `npm-run-path` | Injects local `node_modules/.bin` into `PATH` |
| `get-stream` | Buffers stream output; provides `MaxBufferError` |
| `is-stream` | Type checks for Node.js streams |
| `is-plain-obj` | Distinguishes plain objects from class instances |
| `@sindresorhus/merge-streams` | Merges stdout+stderr into `subprocess.all` |
| `strip-final-newline` | Removes trailing newline from buffered output |
| `human-signals` | Maps signal names to human-readable descriptions |
| `signal-exit` | Hooks into process exit to clean up subprocesses |
| `figures` | Unicode/ASCII symbols for verbose output icons |
| `yoctocolors` | Terminal colors for verbose output |
| `pretty-ms` | Formats `durationMs` in error messages |

---

## 20. Test & Tooling Setup

- **Test runner:** `ava` v6, serial (`concurrency: 1`), 240 s timeout, no worker threads (requires real process spawning).
- **Coverage:** `c8` with `text` + `lcov` reporters; excludes `**/fixtures/**` and test files.
- **Type checking:** `tsd` (v0.32 and v0.29) + `tsc`, tested against both TypeScript 5.8 and 5.1 (`package.json:26`).
- **Linting:** `xo` (ESLint-based), with `unicorn/no-empty-file` and `@typescript-eslint/ban-types` disabled.
- **Test fixtures:** live under `test/` and `test-d/` (TypeScript type tests).
