import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type CallOptions, checkAbortSignal, checkProperties, checkRecord, describe } from "@assesskit/runtime/checks";
import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { type InteractionName, PCI_TYPE_IDENTIFIERS } from "../interaction-types.js";

/** The folder of the built modules: `modules/` of the package, which `src/node/` and `dist/node/` both reach as `../../modules/`. */
const MODULES = fileURLToPath(new URL("../../modules/", import.meta.url));

/** The folder of the modules in an item's package: the module is `modules/<name>.js`, which the item locates as `modules/<name>`. */
const DIRECTORY = "modules/";

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
 * @param options - A signal that ends the reading.
 * @returns The bytes of each file by its path in the package, the module first, under `modules/`. A tool that keeps the
 * modules in another folder renames the keys.
 * @throws `DataError` when the name is not an interaction of the package, or an option is not valid.
 * @throws `AssesskitError` when the package was installed without its built modules.
 */
export async function readModuleFiles(
  name: InteractionName,
  options: CallOptions = {},
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (typeof name !== "string" || !Object.hasOwn(PCI_TYPE_IDENTIFIERS, name)) {
    const names = Object.keys(PCI_TYPE_IDENTIFIERS).map((known) => JSON.stringify(known));
    throw new DataError(`The name of an interaction must be one of ${names.join(", ")}, found ${describe(name)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["signal"]);
  const { signal } = options;
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  const files = new Map<string, Uint8Array>();
  try {
    files.set(`${DIRECTORY}${name}.js`, new Uint8Array(await readFile(`${MODULES}${name}.js`, { signal })));
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new AssesskitError(`The module of ${name} is not built in ${MODULES}: build the package with pnpm build.`, {
      cause: error,
    });
  }
  for (const asset of await listBelow(`${MODULES}${name}`)) {
    const path = `${name}/${asset}`;
    files.set(`${DIRECTORY}${path}`, new Uint8Array(await readFile(`${MODULES}${path}`, { signal })));
  }
  return files;
}
