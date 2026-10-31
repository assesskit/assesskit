import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { SecurityError } from "../errors.js";
import type { PackageFiles, ZipLimits } from "../package/index.js";
import { normalizeEntryName } from "../package/internal.js";

/** One file found in a directory: its path in the package and its size on disk. */
interface Found {
  readonly path: string;
  readonly size: number;
}

function exceeded(limit: keyof ZipLimits, limits: ZipLimits, what: string): SecurityError {
  return new SecurityError(`The directory ${what} the limit ${limit} of ${limits[limit]}.`, limit, limits[limit]);
}

function symlink(path: string): SecurityError {
  return new SecurityError(
    `${JSON.stringify(path)} is a symbolic link; the runtime reads no package directory that contains one.`,
    "symlink",
    0,
  );
}

/** Lists the files below a directory, checking every entry with `lstat` so that no link is followed. */
class Walk {
  readonly found: Found[] = [];
  private entries = 0;
  private total = 0;
  private readonly limits: ZipLimits;

  constructor(limits: ZipLimits) {
    this.limits = limits;
  }

  private addFile(path: string, size: number): void {
    const { limits } = this;
    if (size > limits.maxEntryBytes)
      throw exceeded("maxEntryBytes", limits, `has the file ${JSON.stringify(path)} of ${size} bytes, above`);
    this.total += size;
    if (this.total > limits.maxTotalBytes) throw exceeded("maxTotalBytes", limits, "holds more bytes than");
    this.found.push({ path, size });
  }

  async visit(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      if (++this.entries > this.limits.maxEntries)
        throw exceeded("maxEntries", this.limits, "has more files and directories than");
      const path = normalizeEntryName(`${prefix}${name}`);
      if (path === undefined) {
        throw new SecurityError(
          `The entry ${JSON.stringify(name)} of the directory has a name that is not allowed in a package.`,
          "path",
          0,
        );
      }
      const full = join(directory, name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) throw symlink(path);
      if (stat.isDirectory()) await this.visit(full, `${path}/`);
      else if (stat.isFile()) this.addFile(path, stat.size);
      else throw new SecurityError(`${JSON.stringify(path)} is neither a file nor a directory.`, "special-file", 0);
    }
  }
}

/**
 * Opens an unpacked package directory. Listing it checks every entry with `lstat`; reading a file checks again with `lstat`
 * and `realpath` that the file is a regular file below the directory, and its size against `maxEntryBytes`.
 *
 * @param directory - The path of the package directory.
 * @param limits - The limits, with every field set.
 * @returns The paths of the files, and a function that reads one.
 * @throws `SecurityError` when the directory has a symbolic link, a file that is not a regular file, a name that is not
 * allowed in a package, or exceeds `maxEntries`, `maxEntryBytes` or `maxTotalBytes`.
 */
export async function openDirectory(directory: string, limits: ZipLimits): Promise<PackageFiles> {
  const root = realpathSync(directory);
  const walk = new Walk(limits);
  await walk.visit(root, "");
  return {
    paths: walk.found.map(({ path }) => path),
    read: (path) => {
      const full = join(root, ...path.split("/"));
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw symlink(path);
      if (!(realpathSync(full) + sep).startsWith(`${root}${sep}`) || !stat.isFile()) {
        throw new SecurityError(
          `${JSON.stringify(path)} is not a regular file below the package directory.`,
          "path",
          0,
        );
      }
      if (stat.size > limits.maxEntryBytes)
        throw exceeded("maxEntryBytes", limits, `has the file ${JSON.stringify(path)} of ${stat.size} bytes, above`);
      return new Uint8Array(readFileSync(full));
    },
  };
}
