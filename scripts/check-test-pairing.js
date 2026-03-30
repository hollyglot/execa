#!/usr/bin/env node
/**
 * Verifies that every lib/ source file has at least one corresponding test/ file.
 * Uses prefix matching: lib/foo/bar.js passes if any test/foo/bar*.js exists.
 * See AGENTS.md Rule 4 for the policy this script enforces.
 */

import {readdirSync} from 'node:fs';
import nodePath from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';

const rootDirectory = nodePath.dirname(nodePath.dirname(fileURLToPath(import.meta.url)));

/**
 * Files that existed before this check was introduced and have no test counterpart.
 * New lib/ files NOT on this list must have a matching test/ file.
 */
const GRANDFATHERED = new Set([
	'arguments/command.js',
	'arguments/file-url.js',
	'arguments/options.js',
	'convert/add.js',
	'io/contents.js',
	'ipc/array.js',
	'ipc/methods.js',
	'methods/main-sync.js',
	'resolve/all-async.js',
	'resolve/all-sync.js',
	'resolve/exit-async.js',
	'resolve/exit-sync.js',
	'resolve/wait-stream.js',
	'stdio/handle-async.js',
	'stdio/handle-sync.js',
	'stdio/input-option.js',
	'transform/object-mode.js',
	'transform/run-async.js',
	'transform/run-sync.js',
	'utils/abort-signal.js',
	'utils/deferred.js',
	'utils/max-listeners.js',
	'utils/standard-stream.js',
	'utils/uint-array.js',
	'verbose/default.js',
	'verbose/values.js',
]);

function walkJs(directory) {
	const results = [];
	for (const entry of readdirSync(directory, {withFileTypes: true})) {
		const fullPath = nodePath.join(directory, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkJs(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.js')) {
			results.push(fullPath);
		}
	}

	return results;
}

const libraryDirectory = nodePath.join(rootDirectory, 'lib');
const testDirectory = nodePath.join(rootDirectory, 'test');

const libraryFiles = walkJs(libraryDirectory).map(f => nodePath.relative(libraryDirectory, f));
const testFiles = walkJs(testDirectory).map(f => nodePath.relative(testDirectory, f));

const failures = [];

for (const libraryFile of libraryFiles) {
	if (GRANDFATHERED.has(libraryFile)) {
		continue;
	}

	const directory = nodePath.dirname(libraryFile);
	const base = nodePath.basename(libraryFile, '.js');
	const prefix = directory === '.' ? base : `${directory}/${base}`;
	const hasTest = testFiles.some(t => t.startsWith(prefix));

	if (!hasTest) {
		failures.push(libraryFile);
	}
}

if (failures.length > 0) {
	console.error('Missing test files for the following lib/ sources (see AGENTS.md Rule 4):');
	for (const f of failures) {
		const directory = nodePath.dirname(f);
		const base = nodePath.basename(f, '.js');
		console.error(`  lib/${f}  →  expected test/${directory}/${base}*.js`);
	}

	process.exit(1);
}

console.log(`check-test-pairing: all ${libraryFiles.length - GRANDFATHERED.size} non-grandfathered lib/ files have test coverage.`);
