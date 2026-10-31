import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
// `assesskit schemas fetch` runs the same code, so that one implementation downloads the schemas.
import {
  download,
  fetchSchemas,
  mapConcurrently,
  type SchemaFile,
  sha256,
} from "../packages/runtime/src/cli/fetch-schemas.ts";

const LIST_PATH = "packages/runtime/src/node/schema-files.json";
const CACHE_PATH = ".cache/schemas";

/** Reads the list of schemas that the package pins. */
export function loadList(root: string): SchemaFile[] {
  return JSON.parse(readFileSync(join(root, LIST_PATH), "utf8"));
}

/** Returns the directory the schemas are downloaded to. */
export function schemaDirectory(root: string): string {
  return join(root, CACHE_PATH);
}

/**
 * Returns the schema directory for tests that validate against the schemas.
 *
 * @throws `Error` when the schemas are not downloaded.
 */
export function requireSchemas(root: string): string {
  const directory = schemaDirectory(root);
  if (!existsSync(directory))
    throw new Error(`The schemas are not downloaded to ${directory}: run pnpm schemas first.`);
  return directory;
}

/**
 * Downloads the schemas that are not in the directory with their pinned hashes.
 *
 * @returns The files it downloaded.
 * @throws `Error` when a download fails or differs from its pinned hash; that file is not written.
 */
export async function downloadSchemas(root: string): Promise<string[]> {
  const { downloaded, failures } = await fetchSchemas(schemaDirectory(root), loadList(root));
  if (failures.length > 0) {
    const list = failures.map(({ reason }) => `\n- ${reason}`).join("");
    throw new Error(`Not every schema could be downloaded:${list}\nRun pnpm schemas:pin if a schema changed.`);
  }
  return downloaded.map((schema) => schema.file);
}

/** Downloads every schema and writes its SHA-256 into the list. */
export async function pinSchemas(root: string): Promise<void> {
  const list = loadList(root);
  const hashes = await mapConcurrently(list, async (schema) => sha256(await download(schema.url)));
  const pinned = list.map((schema, index) => ({ ...schema, sha256: hashes[index] }));
  writeFileSync(join(root, LIST_PATH), `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`Pinned ${pinned.length} schemas.`);
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command] = args;
  if (command === "fetch") {
    const downloaded = await downloadSchemas(root);
    console.log(downloaded.length === 0 ? "The schemas are current." : `Downloaded ${downloaded.length} schemas.`);
  } else if (command === "pin") {
    await pinSchemas(root);
  } else {
    throw new Error("Usage: node scripts/schemas.ts fetch | pin");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
