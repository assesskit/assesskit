import type { Stats } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { DataError, type Issue, SecurityError } from "../errors.js";
import { type SchemaSet, validateXmlFiles } from "../node/index.js";
import { DEFAULT_XML_LIMITS } from "../xml/index.js";
import { documentIssues } from "./check-document.js";
import { packageIssues } from "./check-package.js";

/** The first two bytes of a ZIP file, which no XML document can start with. */
const ZIP_SIGNATURE = [0x50, 0x4b];

/** Returns whether a file starts like a ZIP file. */
async function isZip(path: string): Promise<boolean> {
  const file = await open(path);
  try {
    const { bytesRead, buffer } = await file.read(new Uint8Array(ZIP_SIGNATURE.length), 0, ZIP_SIGNATURE.length, 0);
    return bytesRead === ZIP_SIGNATURE.length && ZIP_SIGNATURE.every((byte, index) => buffer[index] === byte);
  } finally {
    await file.close();
  }
}

/** Returns the issues of one XML document: the schema check, then the semantic checks. */
async function documentFileIssues(path: string, size: number, schemas: SchemaSet): Promise<readonly Issue[]> {
  const { maxBytes } = DEFAULT_XML_LIMITS;
  // The file is refused before it is read, so that a huge file cannot exhaust the memory.
  if (size > maxBytes) {
    const message = `The file ${path} has ${size} bytes, above the limit maxBytes of ${maxBytes}.`;
    throw new SecurityError(message, "maxBytes", maxBytes);
  }
  const content = new Uint8Array(await readFile(path));
  return [...(await validateXmlFiles(schemas, [{ path, content }])), ...documentIssues(content, path)];
}

async function statOf(path: string): Promise<Stats> {
  try {
    return await stat(path);
  } catch (error) {
    throw new DataError(`The path ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/**
 * Returns the issues of what a path names: a package when it is a directory or a ZIP file, otherwise one XML
 * document.
 *
 * @param path - The path of a package or of an XML document.
 * @param schemas - The loaded schemas.
 * @returns The issues of the schema check and of the semantic checks.
 * @throws `DataError` when the path cannot be read or is neither a file nor a directory.
 * @throws `SecurityError` when the input is refused: a package that breaks a security rule of `readPackageFile`, or a
 * document above `maxBytes`.
 */
export async function pathIssues(path: string, schemas: SchemaSet): Promise<readonly Issue[]> {
  const stats = await statOf(path);
  if (stats.isDirectory()) return packageIssues(path, schemas);
  if (!stats.isFile()) throw new DataError(`The path ${path} is neither a file nor a directory.`);
  return (await isZip(path)) ? packageIssues(path, schemas) : documentFileIssues(path, stats.size, schemas);
}
