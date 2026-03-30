# Execa Codebase Research Documentation

## Executive Summary

Execa is a Node.js process execution library (v9.6.1) that provides human-friendly interfaces for spawning child processes. The codebase is organized into 13 functional modules under `lib/`, each handling distinct aspects of process execution: argument handling, stdio operations, inter-process communication (IPC), piping, termination, output transformation, and result handling. The library exports six main methods (`execa`, `execaSync`, `execaCommand`, `execaCommandSync`, `execaNode`, and `$`) through a factory pattern, supports both async and sync execution paths, and provides advanced features like graceful cancellation, process piping, and stream transformations.

## Core Architecture

### Entry Points

**File: [index.js](index.js)**

- Exports six main methods created through the `createExeca` factory
- Re-exports error classes: `ExecaError`, `ExecaSyncError`
- Re-exports `parseCommandString` utility
- Exports IPC methods: `sendMessage`, `getOneMessage`, `getEachMessage`, `getCancelSignal`

**File: [index.d.ts](index.d.ts)**

- TypeScript definitions for all public APIs and types
- Exports type definitions from `types/` directory

### Main Methods

1. **execa()** - Standard async method for executing commands with file and arguments
2. **execaSync()** - Synchronous variant of execa
3. **execaCommand()** - Async method that parses command strings into file/args
4. **execaCommandSync()** - Synchronous variant of execaCommand
5. **execaNode()** - Shortcut for executing Node.js scripts
6. **$** - Template string API with script-friendly defaults (stdin: 'inherit', preferLocal: true); supports `.sync` and `.s` aliases

### Method Creation Pattern

**File: [lib/methods/create.js](lib/methods/create.js:1-62)**

- Implements factory function `createExeca()` that wraps all exported methods
- Supports three core features:
  1. Template string syntax: `execa`command argument``
  2. Options binding: `boundExeca = execa(options)` creates partially applied variant
  3. Optional arguments: handles `execa(file)`, `execa(file, args)`, `execa(file, options)`, `execa(file, args, options)`
- Takes parameters: `mapArguments`, `boundOptions`, `deepOptions`, `setBoundExeca`
- Delegates to `callBoundExeca()` for execution routing

## Execution Flow

### Async Execution Path

**File: [lib/methods/main-async.js](lib/methods/main-async.js:1-200)**

Core function: `execaCoreAsync(rawFile, rawArguments, rawOptions, createNested)`

Execution sequence:

1. `handleAsyncArguments()` - Normalizes file, arguments, and options; handles command/shell formatting
2. `spawnSubprocessAsync()` - Spawns process using Node.js `child_process.spawn()`
   - Wraps spawn in try-catch for early error handling
   - Creates AbortController for cleanup coordination
   - Pipes output via `pipeOutputAsync()`
   - Sets up termination handlers via `cleanupOnExit()`
   - Monkey-patches `subprocess.kill()` with force kill timeout support
   - Creates `subprocess.all` stream combining stdout/stderr
   - Adds conversion methods: `readable()`, `writable()`, `duplex()`, `iterable()`
   - Adds IPC methods via `addIpcMethods()`
3. `handlePromise()` - Async orchestration
   - Waits for subprocess result via `waitForSubprocessResult()`
   - Handles timeout, cancellation, and graceful termination
   - Processes stdio streams, applies line splitting/encoding
   - Creates final result object via `makeSuccessResult()` or `makeError()`

### Sync Execution Path

**File: [lib/methods/main-sync.js](lib/methods/main-sync.js:1-145)**

Core function: `execaCoreSync(rawFile, rawArguments, rawOptions)`

Execution sequence:

1. `handleSyncArguments()` - Normalizes arguments and validates sync-specific constraints
   - Validates that options like `ipc`, `ipcInput`, `detached`, `cancelSignal` are not used
2. `spawnSubprocessSync()` - Spawns process using `child_process.spawnSync()`
   - Calls `runSubprocessSync()` which invokes `spawnSync()` and handles early errors
   - Post-processes results with `getExitResultSync()` for exit codes/signals
   - Transforms output with `transformOutputSync()`
3. Returns result immediately (no promise) via `makeSuccessResult()` or `makeError()`

## Module Organization

### 1. Arguments (`lib/arguments/`)

Validates and normalizes all input arguments and options.

**Key Files:**

- **[options.js](lib/arguments/options.js:1-80)** - Main normalization function
  - Uses `cross-spawn._parse()` for platform-specific parsing
  - Calls `normalizeFdSpecificOptions()` for file descriptor specific settings
  - Applies 20+ default options including encoding (utf8), reject (true), cleanup (true), all (false), windowsHide (true)
  - Normalizes kill signal, timeout, encoding, IPC options
  - For Windows cmd.exe, prepends `/q` argument

- **[command.js](lib/arguments/command.js:1-50)** - Command string handling
  - `handleCommand()` - Computes `result.command`, `result.escapedCommand`, and verbose info
  - `parseCommandString()` - Converts command strings into file/args arrays
  - Handles escaped spaces: `foo\ bar` becomes single token

- **[shell.js](lib/arguments/shell.js:1-12)** - Shell concatenation
  - `concatenateShell()` - Joins command/args as string when shell option is true
  - Avoids Node.js deprecation warning by pre-concatenating before passing to spawn

- **[encoding-option.js](lib/arguments/encoding-option.js)** - Encoding validation

- **[cwd.js](lib/arguments/cwd.js)** - Current working directory normalization

- **[fd-options.js](lib/arguments/fd-options.js)** - File descriptor specific options

- **[file-url.js](lib/arguments/file-url.js)** - File URL handling

- **[specific.js](lib/arguments/specific.js)** - FD-specific option normalization

- **[escape.js](lib/arguments/escape.js)** - Command escaping utilities

### 2. Stdio (`lib/stdio/`)

Manages stdin, stdout, stderr handling across platforms.

**Key Files:**

- **[type.js](lib/stdio/type.js:1-100)** - Stdio item type detection
  - Detects types: `asyncGenerator`, `generator`, `fileUrl`, `filePath`, `webStream`, `native`, `uint8Array`, `asyncIterable`, `iterable`, `duplex`, `webTransform`
  - Validates transform stream configurations

- **[handle-async.js](lib/stdio/handle-async.js)** - Async stdio setup
  - Creates file descriptors and streams for async execution

- **[handle-sync.js](lib/stdio/handle-sync.js)** - Sync stdio setup

- **[direction.js](lib/stdio/direction.js)** - Input/output direction determination

- **[native.js](lib/stdio/native.js)** - Native Node.js stream handling

- **[input-option.js](lib/stdio/input-option.js)** - stdin option processing

- **[stdio-option.js](lib/stdio/stdio-option.js)** - stdio array option processing

- **[duplicate.js](lib/stdio/duplicate.js)** - Stream duplication logic

### 3. I/O (`lib/io/`)

Handles input/output stream operations and buffering.

**Key Files:**

- **[output-async.js](lib/io/output-async.js:1-70)** - Async output stream piping
  - `pipeOutputAsync()` - Main function that sets up async stream piping
  - Handles transform streams by piping directly to `subprocess.stdio[fdNumber]`
  - Merges multiple input streams for each output stream
  - Manages max listeners on standard streams

- **[output-sync.js](lib/io/output-sync.js)** - Sync output buffering

- **[input-sync.js](lib/io/input-sync.js)** - Sync input handling

- **[contents.js](lib/io/contents.js)** - Buffer content management

- **[iterate.js](lib/io/iterate.js:1-80)** - Stream iteration
  - `iterateOnSubprocessStream()` - Iterate over subprocess stdout lines
  - `iterateForResult()` - Iterate over buffered output with encoding/line splitting
  - Applies encoding transforms and line splitting based on options

- **[strip-newline.js](lib/io/strip-newline.js)** - Newline stripping logic

- **[pipeline.js](lib/io/pipeline.js)** - Stream pipeline utilities

- **[max-buffer.js](lib/io/max-buffer.js)** - Maximum buffer size handling

### 4. Methods (`lib/methods/`)

Implements the six exported methods and their variants.

**Key Files:**

- **[create.js](lib/methods/create.js:1-62)** - Factory for creating methods

- **[main-async.js](lib/methods/main-async.js:1-200)** - Async method core logic

- **[main-sync.js](lib/methods/main-sync.js:1-145)** - Sync method core logic

- **[script.js](lib/methods/script.js:1-27)** - `$` method implementation
  - Sets script-friendly defaults: `stdin: 'inherit'`, `preferLocal: true`
  - Supports `.sync` and `.s` shortcuts

- **[node.js](lib/methods/node.js:1-55)** - `execaNode()` implementation
  - Maps `execaNode()` to `execa(..., {node: true})`
  - `handleNodeOption()` - Transforms file/args to use specified node binary
  - Validates nodePath, applies nodeOptions (excluding inspect flags)
  - Sets `ipc: true` and `shell: false` automatically

- **[command.js](lib/methods/command.js:1-50)** - `execaCommand()` implementation
  - Parses command string into file/args using `parseCommandString()`

- **[template.js](lib/methods/template.js:1-80)** - Template string syntax
  - `isTemplateString()` - Detects template string usage
  - `parseTemplates()` - Converts `execa`...`` syntax to method call
  - Handles escaped sequences and whitespace between expressions

- **[parameters.js](lib/methods/parameters.js)** - Parameter normalization

- **[promise.js](lib/methods/promise.js)** - Promise customizations

- **[bind.js](lib/methods/bind.js)** - Option binding logic

### 5. Return (`lib/return/`)

Constructs and manages subprocess result objects.

**Key Files:**

- **[result.js](lib/return/result.js:1-100)** - Result object creation
  - `makeSuccessResult()` - Creates success result with all fields
  - `makeEarlyError()` - Result for pre-spawn errors
  - `makeError()` - Result for subprocess errors
  - Result structure includes: command, escapedCommand, cwd, durationMs, failed, timedOut, isCanceled, isGracefullyCanceled, isTerminated, isMaxBuffer, isForcefullyTerminated, exitCode, stdout, stderr, all, stdio, ipcOutput, pipedFrom

- **[final-error.js](lib/return/final-error.js:1-50)** - Error classes
  - `ExecaError` - Async method error
  - `ExecaSyncError` - Sync method error
  - Uses Symbol to identify execa errors across realms
  - `DiscardedError` - Internal use for control flow

- **[duration.js](lib/return/duration.js)** - Execution duration calculation

- **[message.js](lib/return/message.js)** - Error message construction

- **[reject.js](lib/return/reject.js)** - Result handling and rejection

- **[early-error.js](lib/return/early-error.js)** - Pre-spawn error handling

### 6. Resolve (`lib/resolve/`)

Orchestrates waiting for subprocess completion and result assembly.

**Key Files:**

- **[wait-subprocess.js](lib/resolve/wait-subprocess.js:1-100)** - Main result orchestration
  - `waitForSubprocessResult()` - Coordinates all asynchronous operations
  - Waits in parallel for: exit event, stdio streams, IPC output, process streams
  - Uses `Promise.race()` to handle timeout/cancellation early termination
  - Processes results through stdio, all, IPC, and verbose handlers

- **[exit-async.js](lib/resolve/exit-async.js)** - Exit event handling (async)
  - Waits for 'exit' event and extracts exit code/signal

- **[exit-sync.js](lib/resolve/exit-sync.js)** - Exit result processing (sync)

- **[stdio.js](lib/resolve/stdio.js)** - Stdio stream completion

- **[all-async.js](lib/resolve/all-async.js)** - Combined stdout/stderr stream (async)

- **[all-sync.js](lib/resolve/all-sync.js)** - Combined output (sync)

- **[wait-stream.js](lib/resolve/wait-stream.js)** - Stream completion waiting

- **[wait-subprocess.js](lib/resolve/wait-subprocess.js)** - Subprocess event coordination

### 7. Terminate (`lib/terminate/`)

Handles process termination, signals, timeouts, and graceful shutdown.

**Key Files:**

- **[kill.js](lib/terminate/kill.js:1-80)** - Process termination
  - `subprocessKill()` - Monkey-patches subprocess.kill() method
  - Supports `.kill(signal)` and `.kill(error)` variants
  - Implements `forceKillAfterDelay` - escalates to SIGKILL after timeout (default 5000ms)
  - Handles signal normalization and error emission

- **[signal.js](lib/terminate/signal.js)** - Signal handling
  - Normalizes signal names to numbers
  - Gets signal descriptions

- **[timeout.js](lib/terminate/timeout.js)** - Timeout enforcement
  - Validates timeout duration
  - `throwOnTimeout()` - Creates promise that rejects after timeout

- **[cancel.js](lib/terminate/cancel.js)** - Cancellation via AbortSignal
  - Validates cancelSignal option
  - `throwOnCancel()` - Rejects when AbortSignal is aborted

- **[graceful.js](lib/terminate/graceful.js)** - Graceful cancellation
  - `getCancelSignal()` - Returns AbortSignal that fires on graceful cancel
  - `throwOnGracefulCancel()` - Rejects on graceful cancellation

- **[cleanup.js](lib/terminate/cleanup.js)** - Process cleanup on exit

- **[cancel.js](lib/terminate/cancel.js)** - Cancellation signal handling

### 8. Pipe (`lib/pipe/`)

Handles process-to-process piping via `.pipe()` method.

**Key Files:**

- **[setup.js](lib/pipe/setup.js:1-70)** - Pipe method implementation
  - `pipeToSubprocess()` - Main `.pipe()` method added to subprocess
  - Supports options binding: `source.pipe(destination, {options})`
  - `handlePipePromise()` - Orchestrates piping logic
  - Merges source stdout into destination stdin
  - Uses `Promise.race()` to handle errors from either process
  - Returns promise that can chain more pipe calls

- **[pipe-arguments.js](lib/pipe/pipe-arguments.js)** - Pipe argument parsing

- **[sequence.js](lib/pipe/sequence.js)** - Sequential subprocess handling

- **[streaming.js](lib/pipe/streaming.js)** - Stream merging for piping

- **[abort.js](lib/pipe/abort.js)** - Unpipe on abort signal

- **[throw.js](lib/pipe/throw.js)** - Pipe error handling

### 9. IPC (`lib/ipc/`)

Inter-process communication between parent and child processes.

**Key Files:**

- **[methods.js](lib/ipc/methods.js:1-50)** - IPC method setup
  - `addIpcMethods()` - Adds methods to subprocess: sendMessage, getOneMessage, getEachMessage
  - `getIpcExport()` - Exports same methods to subprocess context
  - Binds channel from process for message passing

- **[send.js](lib/ipc/send.js)** - Message sending

- **[get-one.js](lib/ipc/get-one.js)** - Single message receiving

- **[get-each.js](lib/ipc/get-each.js)** - Iterable message receiving

- **[graceful.js](lib/ipc/graceful.js)** - Graceful cancellation signal

- **[buffer-messages.js](lib/ipc/buffer-messages.js)** - Message buffering

- **[incoming.js](lib/ipc/incoming.js)** - Incoming message handling

- **[outgoing.js](lib/ipc/outgoing.js)** - Outgoing message serialization

- **[validation.js](lib/ipc/validation.js)** - IPC option validation

- **[ipc-input.js](lib/ipc/ipc-input.js)** - Initial IPC input

- **[array.js](lib/ipc/array.js)** - Message array handling

- **[reference.js](lib/ipc/reference.js)** - Object reference serialization

- **[forward.js](lib/ipc/forward.js)** - Message forwarding

- **[strict.js](lib/ipc/strict.js)** - Strict mode validation

### 10. Transform (`lib/transform/`)

Transforms output streams with custom logic (generators, web streams, duplex).

**Key Files:**

- **[normalize.js](lib/transform/normalize.js:1-100)** - Transform normalization
  - `normalizeTransforms()` - Processes transform generators, web streams, duplex
  - Handles three types:
    1. Generators with optional `final` and `binary` options
    2. Duplex streams (Node.js)
    3. Web TransformStream
  - Validates object mode compatibility
  - Sorts transforms for correct execution order

- **[run-async.js](lib/transform/run-async.js)** - Async transform execution

- **[run-sync.js](lib/transform/run-sync.js)** - Sync transform execution

- **[generator.js](lib/transform/generator.js)** - Generator transform handler

- **[encoding-transform.js](lib/transform/encoding-transform.js)** - Character encoding

- **[split.js](lib/transform/split.js)** - Line splitting

- **[object-mode.js](lib/transform/object-mode.js)** - Object mode handling

- **[validate.js](lib/transform/validate.js)** - Transform validation

### 11. Convert (`lib/convert/`)

Adds stream conversion methods to subprocess: `readable()`, `writable()`, `duplex()`, `iterable()`.

**Key Files:**

- **[add.js](lib/convert/add.js:1-15)** - Conversion method setup
  - `addConvertedStreams()` - Attaches conversion methods to subprocess
  - Binds concurrent stream management for coordinated access

- **[readable.js](lib/convert/readable.js)** - Convert to Readable stream

- **[writable.js](lib/convert/writable.js)** - Convert to Writable stream

- **[duplex.js](lib/convert/duplex.js)** - Convert to Duplex stream

- **[iterable.js](lib/convert/iterable.js)** - Convert to async iterable

- **[concurrent.js](lib/convert/concurrent.js)** - Concurrent access management

- **[shared.js](lib/convert/shared.js)** - Shared utilities

### 12. Verbose (`lib/verbose/`)

Implements verbose logging for debugging subprocess execution.

Files: `info.js`, `values.js`, `start.js`, etc. - Provides verbose output at different levels (none, short, full) with customizable formatting.

### 13. Utils (`lib/utils/`)

Utility functions used across the codebase.

**Key Files:**

- **[deferred.js](lib/utils/deferred.js)** - Deferred promise pattern

- **[abort-signal.js](lib/utils/abort-signal.js)** - AbortSignal utilities

- **[standard-stream.js](lib/utils/standard-stream.js)** - Standard stream detection

- **[max-listeners.js](lib/utils/max-listeners.js)** - Max listeners management

- **[uint-array.js](lib/utils/uint-array.js)** - Uint8Array utilities

## Data Flow Examples

### Basic Execution Flow (Async)

```
execa('npm', ['test'], options)
  ↓
createExeca factory
  ↓
callBoundExeca()
  ↓
parseArguments() - normalize file/args/options
  ↓
execaCoreAsync()
  ├→ handleAsyncArguments()
  │   ├→ handleCommand() - compute escaped command
  │   ├→ normalizeOptions() - apply defaults, validate
  │   └→ handleStdioAsync() - prepare stdio streams
  ├→ spawnSubprocessAsync()
  │   ├→ spawn() - create child process
  │   ├→ pipeOutputAsync() - setup input/output streams
  │   ├→ cleanupOnExit() - register cleanup handlers
  │   ├→ addConvertedStreams() - add readable/writable/duplex/iterable
  │   └→ addIpcMethods() - add IPC methods
  ├→ mergePromise() - attach subprocess promise
  └→ return subprocess (promise-like with .pipe() method)

await subprocess
  ↓
handlePromise()
  ├→ waitForSubprocessResult()
  │   ├→ waitForExit() - 'exit' event
  │   ├→ waitForStdioStreams() - stdout/stderr/stdio[fd]
  │   ├→ waitForAllStream() - merged stdout+stderr
  │   ├→ waitForIpcOutput() - IPC messages
  │   ├→ sendIpcInput() - send initial IPC
  │   ├→ throwOnTimeout() - timeout handling
  │   ├→ throwOnCancel() - cancellation handling
  │   └→ throwOnGracefulCancel() - graceful stop
  └→ makeSuccessResult() or makeError()
```

### Pipe Flow

```
source.pipe(destination)
  ↓
pipeToSubprocess()
  ├→ normalizePipeArguments()
  │   └→ resolve destination subprocess
  └→ handlePipePromise()
      ├→ pipeSubprocessStream() - merge source.stdout → destination.stdin
      ├→ waitForBothSubprocesses() - wait for both exit
      └→ unpipeOnAbort() - cleanup on signal

await piped
  ↓
source completes and piped result returns
```

### Transform Flow

```
execa(..., {
  stdout: {transform: generatorFunction}
})
  ↓
stdout stream chunks
  ↓
generator receives chunks in for-await loop
  ↓
generator yields transformed chunks
  ↓
chunks collected in result.stdout
```

## Key Patterns and Mechanisms

### 1. Factory Pattern

- `createExeca()` creates customizable method versions
- Enables method chaining: `execa(options).pipe(otherCommand)`
- Supports options binding: `execa(defaultOptions)`

### 2. Promise-like Pattern

- Subprocess is both a ChildProcess and a Promise
- Can be `await`-ed for results
- Has `.pipe()` method for streaming to other processes
- Has conversion methods: `.readable()`, `.writable()`, `.duplex()`, `.iterable()`

### 3. Stream Handling

- Multiple input streams merged before piping to subprocess.stdin
- Transform generators applied to output streams
- Supports Node.js streams, Web streams, generators, duplex streams
- Handles object mode and encoding transforms

### 4. Error Handling

- `ExecaError` for async failures
- `ExecaSyncError` for sync failures
- `DiscardedError` for internal control flow
- Errors include subprocess context: command, exitCode, signal, output

### 5. Timeout and Cancellation

- Timeout via `timeoutDuration` option
- Cancellation via `cancelSignal` (AbortSignal)
- Graceful cancellation via `gracefulCancel` option
- Force kill via `forceKillAfterDelay` (default 5s after initial signal)

### 6. IPC (Inter-Process Communication)

- Enables message passing between parent and child
- Methods: `sendMessage()`, `getOneMessage()`, `getEachMessage()`, `getCancelSignal()`
- Automatic serialization with `serialization` option
- Initial IPC via `ipcInput` option

### 7. Options Binding

- Deep options (like `preferLocal: true` for `$`) apply to piped commands
- Some options excluded from deep binding (like `stdin: 'inherit'`)
- Allows clean composition: `$(...).pipe($(...)).pipe(...)`

### 8. Verbose Logging

- Supports levels: 'none', 'short', 'full'
- Can use custom function for formatting
- Different verbosity per fd or shared
- Logs command before execution, output on full verbosity

## Cross-Module Integrations

1. **Arguments → Return**: Command/options flow from arguments processing to result construction
2. **Stdio → I/O → Transform**: Stdio handles setup, I/O manages streams, Transform applies custom logic
3. **Resolve → Terminate**: Resolution coordinates listening to subprocess events; termination handles cleanup
4. **Pipe → Resolve**: Pipe creates relationships between subprocesses via resolve coordination
5. **Methods → Convert**: Methods create subprocesses; convert adds stream interfaces
6. **IPC → Resolve**: IPC messages buffered and returned as part of resolved result
7. **Verbose → All Modules**: Verbose info passed through argument handling, logged at spawn and completion

## Type System

**File: [types/](types/)**

TypeScript definitions mirror lib structure:

- `types/arguments/options.js` - Options type definitions
- `types/methods/main-async.js` - ExecaMethod type
- `types/methods/main-sync.js` - ExecaSyncMethod type
- `types/subprocess/subprocess.d.ts` - Subprocess type with all methods
- `types/return/result.js` - Result and SyncResult types
- `types/stdio/` - Stdio type hierarchy
- `types/transform/` - Transform option types
- `types/convert.d.ts` - Conversion method signatures
- `types/ipc.d.ts` - IPC method signatures
- `types/pipe.d.ts` - Pipe method signature
- `types/verbose.d.ts` - Verbose option types

## Configuration

**File: [package.json](package.json:1-50)**

- Node version: ^18.19.0 || >=20.5.0
- Type: "module" (ESM only)
- No side effects
- Exports: index.js (default), index.d.ts (types)
- Main files included in distribution: index.js, index.d.ts, lib/**, types/**

**File: [tsconfig.json](tsconfig.json)**

- ESM configuration for TypeScript compilation

## File Organization Summary

```
lib/                                 # Implementation
├── arguments/     (9 files)         # Argument/option parsing and validation
├── convert/       (7 files)         # Stream conversion methods
├── io/            (8 files)         # Input/output stream handling
├── ipc/           (14 files)        # Inter-process communication
├── methods/       (10 files)        # Main exported methods
├── pipe/          (6 files)         # Process piping
├── resolve/       (7 files)         # Result resolution and subprocess coordination
├── return/        (6 files)         # Result object and error construction
├── stdio/         (9 files)         # Stdio configuration and streaming
├── terminate/     (6 files)         # Process termination and signals
├── transform/     (8 files)         # Output stream transformations
├── utils/         (5 files)         # Utility functions
└── verbose/       (varies)          # Verbose logging

types/                               # TypeScript Definitions (mirrors lib)
├── arguments/
├── methods/
├── subprocess/
├── return/
├── stdio/
├── transform/
├── convert.d.ts
├── ipc.d.ts
├── pipe.d.ts
├── utils.d.ts
└── verbose.d.ts

test/                                # Test suites (mirrors lib structure)
test-d/                              # TypeScript-only tests with tsd
docs/                                # Documentation markdown files
```

## Summary of Responsibilities by Module

| Module    | Responsibility                                                           |
| --------- | ------------------------------------------------------------------------ |
| arguments | Parse/validate/normalize CLI arguments and options                       |
| stdio     | Configure and manage stdin/stdout/stderr streams and file descriptors    |
| io        | Handle asynchronous stream piping and buffering                          |
| methods   | Implement the six exported command execution methods                     |
| return    | Create result objects and error instances                                |
| resolve   | Coordinate waiting for subprocess completion and result assembly         |
| terminate | Handle process killing, signals, timeouts, and graceful shutdown         |
| pipe      | Enable piping between subprocesses via `.pipe()`                         |
| ipc       | Enable message passing between parent and child processes                |
| transform | Apply custom transformations to output streams (generators, Duplex, Web) |
| convert   | Add `.readable()`, `.writable()`, `.duplex()`, `.iterable()` methods     |
| utils     | Provide shared utilities (deferred, AbortSignal, stream detection, etc.) |
| verbose   | Log subprocess execution details at configured levels                    |
