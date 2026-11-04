import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type CallOptions,
  checkAbortSignal,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "@assesskit/runtime/checks";
import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { INTERACTION_TYPES, type InteractionName } from "../interaction-types.js";

/** The folder of the built modules: `modules/` of the package, which `src/node/` and `dist/node/` both reach as `../../modules/`. */
const MODULES = fileURLToPath(new URL("../../modules/", import.meta.url));

/** The default folder of the modules in an item's package. */
const DEFAULT_DIRECTORY = "modules/";

/** A character that a path of a package does not hold: a C0 or C1 control character, NUL included, or the backslash. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what the pattern finds.
const NOT_IN_PATH = /[\u0000-\u001f\u007f-\u009f\\]/u;

/** Whether a folder of a package is in normal form: segments that each end in `/`, none empty, `.` or `..`, or the root. */
function isPackageFolder(directory: string): boolean {
  if (directory === "") return true;
  if (!directory.endsWith("/") || NOT_IN_PATH.test(directory)) return false;
  return directory
    .slice(0, -1)
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** The options of {@link readModuleFiles}. */
export interface ReadModuleFilesOptions extends CallOptions {
  /**
   * The folder of the item's package that holds the modules, ending in `/`, or `""` for the root of the package. The
   * module is `<directory><name>.js`, which the item locates as `<directory><name>`, and its other files are below
   * `<directory><name>/`.
   *
   * @defaultValue `"modules/"`
   */
  readonly directory?: string;
}

/** Lists the files below a folder, as paths relative to it with `/`, in order; none when there is no such folder. */
async function listBelow(folder: string): Promise<readonly string[]> {
  let entries: readonly Dirent[];
  try {
    entries = await readdir(folder, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath.slice(folder.length).replaceAll("\\", "/")}/${entry.name}`.replace(/^\//, ""))
    .sort();
}

/**
 * Reads the files of an interaction's AMD module, which an item's package carries so that the frame of a portable custom
 * interaction, which reaches no network, loads the interaction entirely from the package: the module and the files it
 * loads, MathLive's fonts for math entry.
 *
 * @example
 * ```ts
 * import { readModuleFiles } from "@assesskit/custom-interactions/node";
 *
 * const files = await readModuleFiles("math-entry");
 * files.has("modules/math-entry.js"); // => true
 * files.has("modules/math-entry/fonts/KaTeX_Main-Regular.woff2"); // => true
 * ```
 *
 * @param name - The interaction.
 * @param options - The folder of the modules in the package, and a signal that ends the reading.
 * @returns The bytes of each file by its path in the package, the module first.
 * @throws `DataError` when the name is not an interaction of the package, an option is not valid, or the folder is not a
 * folder of a package in normal form.
 * @throws `AssesskitError` when the package was installed without its built modules.
 */
export async function readModuleFiles(
  name: InteractionName,
  options: ReadModuleFilesOptions = {},
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (typeof name !== "string" || !Object.hasOwn(INTERACTION_TYPES, name)) {
    const names = Object.keys(INTERACTION_TYPES).map((known) => JSON.stringify(known));
    throw new DataError(`The name of an interaction must be one of ${names.join(", ")}, found ${describe(name)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["directory", "signal"]);
  const { directory = DEFAULT_DIRECTORY, signal } = options;
  checkString(directory, "The option directory");
  if (!isPackageFolder(directory)) {
    throw new DataError(
      `The option directory must be a folder of a package ending in "/", or "" for its root, found ${JSON.stringify(directory)}.`,
    );
  }
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  const files = new Map<string, Uint8Array>();
  try {
    files.set(`${directory}${name}.js`, new Uint8Array(await readFile(`${MODULES}${name}.js`, { signal })));
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new AssesskitError(`The module of ${name} is not built in ${MODULES}: build the package with pnpm build.`, {
      cause: error,
    });
  }
  for (const asset of await listBelow(`${MODULES}${name}`)) {
    const path = `${name}/${asset}`;
    files.set(`${directory}${path}`, new Uint8Array(await readFile(`${MODULES}${path}`, { signal })));
  }
  return files;
}
