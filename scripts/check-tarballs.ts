import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The packages that the check packs, installs and imports. */
const PACKAGES = ["runtime", "player", "custom-interactions"] as const;

/** The fields of a `package.json` that tell which specifiers a user can import. */
export interface Manifest {
  readonly name: string;
  readonly exports: Readonly<Record<string, unknown>>;
}

/** How TypeScript resolves the specifiers of the scratch project, one run for each. */
export const RESOLUTIONS = [
  { moduleResolution: "bundler", module: "esnext" },
  { moduleResolution: "node16", module: "node16" },
] as const;

/**
 * Returns the specifiers of a package that load code: those whose export has a `types` entry. A subpath that exports a
 * file, such as the stylesheet or the worklet, is not a module.
 */
export function moduleSpecifiers(manifest: Manifest): string[] {
  return Object.entries(manifest.exports)
    .filter(([, target]) => typeof target === "object" && target !== null && "types" in target)
    .map(([subpath]) => (subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`));
}

/** The source of the module that imports every specifier in Node, which fails with the specifier that does not load. */
export function importAll(specifiers: readonly string[]): string {
  const lines = specifiers.map(
    (specifier) =>
      `await import(${JSON.stringify(specifier)}).catch((error) => { throw new Error(${JSON.stringify(`${specifier} does not load: `)} + error.message); });`,
  );
  return `${lines.join("\n")}\nconsole.log(${JSON.stringify(`${specifiers.length} specifiers load in Node.`)});\n`;
}

/** The source of the file that TypeScript checks: one import of each specifier, so that its types must resolve. */
export function typeAll(specifiers: readonly string[]): string {
  return `${specifiers.map((specifier, index) => `import type * as m${index} from ${JSON.stringify(specifier)};`).join("\n")}\nexport type {${specifiers.map((_, index) => ` m${index}`).join(",")} };\n`;
}

/** Runs a command and returns its exit code, printing what it said when it failed. */
function run(command: string, args: readonly string[], cwd: string): number {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) console.error(`${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.status ?? 1;
}

/** Packs the packages, installs them into a scratch project, imports every subpath in Node and type-checks them. */
function main(): number {
  const root = resolve(import.meta.dirname, "..");
  const scratch = mkdtempSync(join(tmpdir(), "assesskit-tarballs-"));
  try {
    const packed = join(scratch, "packed");
    mkdirSync(packed);
    const manifests = PACKAGES.map(
      (name): Manifest => JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")),
    );
    for (const name of PACKAGES) {
      if (run("pnpm", ["--dir", join(root, "packages", name), "pack", "--pack-destination", packed], root) !== 0) {
        return 1;
      }
    }
    const project = join(scratch, "project");
    mkdirSync(project);
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "scratch", private: true, type: "module" }));
    const tarballs = readdirSync(packed).map((file) => join(packed, file));
    if (run("npm", ["install", "--no-audit", "--no-fund", ...tarballs], project) !== 0) return 1;
    const specifiers = manifests.flatMap(moduleSpecifiers);
    writeFileSync(join(project, "import-all.mjs"), importAll(specifiers));
    if (run(process.execPath, ["import-all.mjs"], project) !== 0) return 1;
    writeFileSync(join(project, "type-all.ts"), typeAll(specifiers));
    const tsc = join(root, "node_modules/typescript/bin/tsc");
    for (const resolution of RESOLUTIONS) {
      const config = {
        compilerOptions: {
          ...resolution,
          target: "es2023",
          lib: ["es2023", "dom", "dom.iterable"],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          typeRoots: [join(root, "node_modules/@types")],
          types: ["node"],
        },
        files: ["type-all.ts"],
      };
      writeFileSync(join(project, `tsconfig.${resolution.moduleResolution}.json`), JSON.stringify(config));
      if (run(process.execPath, [tsc, "-p", `tsconfig.${resolution.moduleResolution}.json`], project) !== 0) return 1;
    }
    console.log(
      `${specifiers.length} specifiers of the tarballs load in Node and type-check with ${RESOLUTIONS.map((each) => each.moduleResolution).join(" and ")}.`,
    );
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exitCode = main();
