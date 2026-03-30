import {createExeca} from './lib/methods/create.js';
import {mapCommandAsync, mapCommandSync} from './lib/methods/command.js';
import {mapNode} from './lib/methods/node.js';
import {mapScriptAsync, setScriptSync, deepScriptOptions} from './lib/methods/script.js';
import {getIpcExport} from './lib/ipc/methods.js';

export {parseCommandString} from './lib/methods/command.js';
export {ExecaError, ExecaSyncError} from './lib/return/final-error.js';

/**
 * Runs a command asynchronously, returning a promise for the result.
 * @param {string} file - The program or script to execute.
 * @param {string[]} [arguments_] - Arguments to pass to the program.
 * @param {object} [options] - Options to configure execution behavior.
 * @returns {object} A promise for the subprocess result, with additional subprocess properties.
 */
export const execa = createExeca(() => ({}));

/**
 * Runs a command synchronously, blocking until the command completes.
 * @param {string} file - The program or script to execute.
 * @param {string[]} [arguments_] - Arguments to pass to the program.
 * @param {object} [options] - Options to configure execution behavior.
 * @returns {object} The subprocess result.
 */
export const execaSync = createExeca(() => ({isSync: true}));

/**
 * Runs a command string asynchronously, parsing it into file and arguments.
 * @deprecated Prefer `execa` with an explicit arguments array instead.
 * @param {string} command - The command string to parse and execute.
 * @param {object} [options] - Options to configure execution behavior.
 * @returns {object} A promise for the subprocess result.
 */
export const execaCommand = createExeca(mapCommandAsync);

/**
 * Runs a command string synchronously, parsing it into file and arguments.
 * @deprecated Prefer `execaSync` with an explicit arguments array instead.
 * @param {string} command - The command string to parse and execute.
 * @param {object} [options] - Options to configure execution behavior.
 * @returns {object} The subprocess result.
 */
export const execaCommandSync = createExeca(mapCommandSync);

/**
 * Runs a Node.js script file as a child process with IPC enabled.
 * @param {string} scriptPath - Path to the Node.js script to execute.
 * @param {string[]} [arguments_] - Arguments to pass to the script.
 * @param {object} [options] - Options to configure execution behavior.
 * @returns {object} A promise for the subprocess result.
 */
export const execaNode = createExeca(mapNode);

/**
 * Tagged template literal API for running commands in a shell-script style.
 * Can also be called as a regular function. Supports both async and sync variants.
 * @param {object|string} [options] - Options object or first template string part.
 * @returns {object} A promise for the subprocess result, or a bound `$` with options applied.
 */
export const $ = createExeca(mapScriptAsync, {}, deepScriptOptions, setScriptSync);

const {
	sendMessage,
	getOneMessage,
	getEachMessage,
	getCancelSignal,
} = getIpcExport();
export {
	sendMessage,
	getOneMessage,
	getEachMessage,
	getCancelSignal,
};
