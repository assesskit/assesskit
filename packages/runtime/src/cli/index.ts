/**
 * Node.js only: the command line of the runtime, `assesskit validate` and `assesskit schemas fetch`. The `assesskit` program of the package
 * runs {@link runCli} with the arguments of the process.
 *
 * @module @assesskit/runtime/cli
 */
export type { RunCliOptions } from "./options.js";
export { runCli } from "./run.js";
