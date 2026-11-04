import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
// biome-ignore lint/style/noRestrictedImports: A type-only import, erased before Node runs the script, so the `.js` specifiers of the module's files do not matter; the run loads the build.
import type { SchemaSet } from "../packages/runtime/src/node/index.ts";
// biome-ignore lint/style/noRestrictedImports: The same.
import type { QtiPackage } from "../packages/runtime/src/package/index.ts";
import { downloadText } from "./download.ts";
import { requireSchemas } from "./schemas.ts";

/** The public conformance document, whose Appendix A lists the features and whose section 3 gives their levels. */
const CERT_URL = "https://www.imsglobal.org/spec/qti/v3p0/conf/";
/** The features of the document, which `pin` writes, relative to the repository root. */
const FEATURES_PATH = "scripts/conformance-features.json";
/** The file of a run, in the directory of the reports. */
const REPORT_FILE = "report.json";
/** The directory of a run, in the directory of the reports, that holds what the member's validator takes. */
const EXPORTS_DIRECTORY = "exports";
/** The manifest of an unpacked package. */
const MANIFEST = "imsmanifest.xml";
/** The types of the resources that are QTI documents, which an export writes through the model. */
const ASI_RESOURCES: readonly string[] = [
  "imsqti_test_xmlv3p0",
  "imsqti_section_xmlv3p0",
  "imsqti_item_xmlv3p0",
  "imsqti_stimulus_xmlv3p0",
];
/** The form of a feature ID: the letter of an area of Appendix A, a number and sometimes a letter. */
const FEATURE_ID = /^[A-Z]-\d+[a-z]?$/;

/** A level that requires a feature: the two levels of certification, and the Elevated Accessibility bundle. */
export type ConformanceLevel = "Basic" | "Advanced" | "Elevated";

/** A feature of Appendix A. */
export interface ConformanceFeature {
  /** The ID of the feature, such as `Q-2`. */
  readonly id: string;
  /** The name that Appendix A gives it. */
  readonly name: string;
  /** The levels that require it; none means that it is elective. */
  readonly required: readonly ConformanceLevel[];
}

/** A file or directory that a run takes. */
export interface ConformanceInput {
  /** Its path, relative to the directory of the packages. */
  readonly path: string;
  /** A ZIP file or a directory with a manifest is a package; any other XML file is a document, such as a PNP. */
  readonly kind: "package" | "document";
}

/** What a run found for a test of a package. */
export interface TestStart {
  /** The path of the test in the package. */
  readonly href: string;
  /** Why the engine refused it; absent when a session started. */
  readonly refusal?: string;
}

/** What a run found for one input. */
export interface InputReport extends ConformanceInput {
  /** Whether `assesskit validate` found no error. */
  readonly valid: boolean;
  /** The report of `assesskit validate --format json`, or the error of a run that gave none. */
  readonly validation: unknown;
  /** The tests of a package, each started in the engine. */
  readonly tests?: readonly TestStart[];
  /** Where the export of the package went, relative to the directory of the reports. */
  readonly exported?: string;
  /** Why a package that is valid could not be exported or started. */
  readonly failure?: string;
}

/** The modules of the runtime that a run uses: the build, or the sources in a test. */
export interface RuntimeModules {
  /** The writer of the QTI documents. */
  readonly asi: typeof import("../packages/runtime/src/asi/index.ts");
  /** The checks of `assesskit validate`, which take schemas that a run compiles once. */
  readonly cli: typeof import("../packages/runtime/src/cli/internal.ts");
  /** The delivery engine, which starts the session of each test. */
  readonly delivery: typeof import("../packages/runtime/src/delivery/index.ts");
  /** The files of Node.js. */
  readonly node: typeof import("../packages/runtime/src/node/index.ts");
  /** The resolvers, the resource paths and the writer of a package. */
  readonly packages: typeof import("../packages/runtime/src/package/index.ts");
}

/** The options of {@link runConformance}. */
export interface RunOptions {
  /** The directory of the official packages. */
  readonly packages: string;
  /** The directory that gets the report and the exports. */
  readonly reports: string;
  /** The directory of the schemas. */
  readonly schemas: string;
}

/** Returns the text of a cell or a heading of the document: without markup, entities and runs of white space. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the rows of a table of the document, as the text of each cell. */
function rowsOf(table: string): readonly (readonly string[])[] {
  return Array.from(table.matchAll(/<tr[\s>][\s\S]*?<\/tr>/g), ([row]) =>
    Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g), ([, cell]) => textOf(cell ?? "")),
  );
}

/** Returns the tables of the document, each with the text of the last heading before it. */
function tablesOf(page: string): readonly { readonly heading: string; readonly table: string }[] {
  const parts = page.split(/<table[\s>]/);
  return parts.slice(1).map((part, index) => {
    const headings = Array.from(parts[index]?.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g) ?? []);
    return { heading: textOf(headings.at(-1)?.[1] ?? ""), table: part.slice(0, part.indexOf("</table>")) };
  });
}

/** Returns the levels that a row of a table requires, by the heading of the table: an `R` for Basic and for Advanced in section 3.1, and any row of sections 3.3 and 3.4. */
function levelsOf(heading: string, [, , basic, advanced]: readonly string[]): readonly ConformanceLevel[] {
  if (/^3\.[34] /.test(heading)) return ["Elevated"];
  if (!/^3\.1\.\d/.test(heading)) return [];
  return [
    ...(basic?.startsWith("R") ? ["Basic" as const] : []),
    ...(advanced?.startsWith("R") ? ["Advanced" as const] : []),
  ];
}

/**
 * Returns the features that the conformance document lists: every row of the tables of Appendix A, with the levels that the
 * tables of sections 3.1, 3.3 and 3.4 give it.
 *
 * @param page - The HTML of the document.
 * @returns The features in the order of Appendix A.
 * @throws \`Error\` when the page has no such tables.
 */
export function parseFeatures(page: string): readonly ConformanceFeature[] {
  const names = new Map<string, string>();
  const required = new Map<string, Set<ConformanceLevel>>();
  for (const { heading, table } of tablesOf(page)) {
    for (const row of rowsOf(table).filter(([id]) => FEATURE_ID.test(id ?? ""))) {
      const [id = "", name = ""] = row;
      if (/^A\.\d/.test(heading)) names.set(id, name);
      required.set(id, new Set([...(required.get(id) ?? []), ...levelsOf(heading, row)]));
    }
  }
  if (names.size === 0)
    throw new Error("The page has no tables of Appendix A; the document may have changed its form.");
  return Array.from(names, ([id, name]) => ({ id, name, required: [...(required.get(id) ?? [])] }));
}

/** Returns the real path of a path that may not exist yet: that of the nearest directory above it that does. */
function realPathOf(path: string): string {
  let current = resolve(path);
  while (!existsSync(current)) current = dirname(current);
  return realpathSync(current);
}

/**
 * Checks that a path lies outside the repository, following symbolic links, so that member-only material and the reports of
 * the validator cannot end up in a commit.
 *
 * @param root - The root of the repository.
 * @param path - The path, which need not exist yet.
 * @param label - Names the path in the error message.
 * @throws `Error` when the path is the repository or lies inside it.
 */
export function checkOutsideRepository(root: string, path: string, label: string): void {
  const from = relative(realpathSync(root), realPathOf(path));
  const outside = from === ".." || from.startsWith(`..${sep}`) || isAbsolute(from);
  if (!outside) throw new Error(`${label} ${path} is inside the repository; keep member-only material outside it.`);
}

/**
 * Returns the packages and the documents below a directory, folder by folder and each in the order of its names: a ZIP file,
 * a directory with a manifest and no ZIP file beside it, which would stand for it, and any other XML file. Hidden entries and
 * symbolic links are left out.
 *
 * @param directory - The directory.
 * @returns The inputs, with paths relative to it.
 */
export function discoverInputs(directory: string): readonly ConformanceInput[] {
  const found: ConformanceInput[] = [];
  const visit = (folder: string): void => {
    const entries = readdirSync(folder, { withFileTypes: true })
      .filter(({ name }) => !name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((entry) => entry.isFile()).map(({ name }) => name);
    const zips = files.filter((name) => name.endsWith(".zip"));
    for (const name of zips) found.push({ path: relative(directory, join(folder, name)), kind: "package" });
    if (files.includes(MANIFEST)) {
      if (zips.length === 0) found.push({ path: relative(directory, folder), kind: "package" });
      return;
    }
    for (const name of files.filter((each) => each.endsWith(".xml"))) {
      found.push({ path: relative(directory, join(folder, name)), kind: "document" });
    }
    for (const entry of entries) if (entry.isDirectory()) visit(join(folder, entry.name));
  };
  visit(directory);
  return found;
}

/** Returns the message of an error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Applies the checks of `assesskit validate` to an input, and gives its report or why it has none. */
async function validateInput(
  { cli }: RuntimeModules,
  source: string,
  input: ConformanceInput,
  schemas: SchemaSet,
): Promise<Pick<InputReport, "valid" | "validation">> {
  try {
    const report = cli.buildReport(input.path, cli.packageVersion(), await cli.pathIssues(source, schemas));
    return { valid: report.valid, validation: report };
  } catch (error) {
    return { valid: false, validation: messageOf(error) };
  }
}

/** Starts a session of a test of a package, and gives the refusal of the engine, if any. */
function startTest({ delivery, packages }: RuntimeModules, pkg: QtiPackage, href: string): TestStart {
  try {
    const document = pkg.document(href);
    if (document.kind !== "test") return { href, refusal: `${href} is not a test.` };
    const resolvers = packages.createPackageResolvers(pkg);
    const definition = { kind: "test", test: document.test, base: href, resolvers } as const;
    const started = delivery.createEngine(definition).start({ seed: 1, at: 0 });
    return started.ok ? { href } : { href, refusal: started.refusal.message };
  } catch (error) {
    return { href, refusal: messageOf(error) };
  }
}

/**
 * Writes a package as this runtime exports it: each QTI document goes through the model, so that the validator of 1EdTech judges
 * what the writer makes and not what the package held.
 */
function exportPackage({ asi, packages }: RuntimeModules, pkg: QtiPackage, target: string): void {
  const files = new Map<string, Uint8Array>();
  for (const path of pkg.paths.filter((each) => each !== MANIFEST)) {
    const bytes = pkg.file(path);
    if (bytes !== undefined) files.set(path, bytes);
  }
  for (const resource of pkg.manifest.resources) {
    const path = packages.resolveResourcePath(pkg.manifest, resource);
    if (path === undefined || !ASI_RESOURCES.includes(resource.type)) continue;
    files.set(path, new TextEncoder().encode(asi.writeAsi(pkg.document(path))));
  }
  writeFileSync(target, packages.writePackage(pkg.manifest, files));
}

/** Starts the tests of a package and exports it, for an input that is valid. */
async function exerciseInput(
  modules: RuntimeModules,
  source: string,
  reports: string,
  input: ConformanceInput,
): Promise<Pick<InputReport, "tests" | "exported" | "failure">> {
  try {
    const pkg = await modules.node.readPackageFile(source);
    const tests = pkg.manifest.resources.flatMap(({ type, href }) =>
      type === "imsqti_test_xmlv3p0" && href !== undefined ? [href] : [],
    );
    const exported = join(EXPORTS_DIRECTORY, `${input.path.replace(/\.zip$/, "")}.zip`);
    mkdirSync(dirname(join(reports, exported)), { recursive: true });
    exportPackage(modules, pkg, join(reports, exported));
    return { exported, tests: tests.map((href) => startTest(modules, pkg, href)) };
  } catch (error) {
    return { failure: messageOf(error) };
  }
}

/**
 * Takes each package and document below a directory through the runtime: the checks of `assesskit validate`, and for a valid
 * package a session of each test and an export. It writes `report.json` after each input, and the exports for the validator of
 * 1EdTech, whose own reports belong in the same directory. Some official packages are problematic on purpose, so a verdict does
 * not stop a run.
 *
 * @param root - The root of the repository, which both directories must lie outside.
 * @param options - See {@link RunOptions}.
 * @param modules - The modules of the runtime.
 * @returns What it found, in the order of `discoverInputs`.
 * @throws `Error` when a directory lies inside the repository.
 */
export async function runConformance(
  root: string,
  options: RunOptions,
  modules: RuntimeModules,
): Promise<readonly InputReport[]> {
  const { packages, reports } = options;
  checkOutsideRepository(root, packages, "The directory of the packages");
  checkOutsideRepository(root, reports, "The directory of the reports");
  mkdirSync(reports, { recursive: true });
  const schemas = await modules.node.loadSchemaSet(options.schemas);
  const inputs: InputReport[] = [];
  try {
    for (const input of discoverInputs(packages)) {
      const source = join(packages, input.path);
      const verdict = await validateInput(modules, source, input, schemas);
      const usable = input.kind === "package" && verdict.valid;
      inputs.push({ ...input, ...verdict, ...(usable ? await exerciseInput(modules, source, reports, input) : {}) });
      writeFileSync(join(reports, REPORT_FILE), `${JSON.stringify({ inputs }, null, 2)}\n`);
    }
  } finally {
    schemas.close();
  }
  return inputs;
}

/** Loads the modules of the build, which `pnpm conformance` makes first. */
async function builtModules(root: string): Promise<RuntimeModules> {
  const load = <T>(path: string): Promise<T> => import(pathToFileURL(join(root, "packages/runtime/dist", path)).href);
  return {
    asi: await load<RuntimeModules["asi"]>("asi/index.js"),
    cli: await load<RuntimeModules["cli"]>("cli/internal.js"),
    delivery: await load<RuntimeModules["delivery"]>("delivery/index.js"),
    node: await load<RuntimeModules["node"]>("node/index.js"),
    packages: await load<RuntimeModules["packages"]>("package/index.js"),
  };
}

/** Downloads the conformance document and writes the features of the repository from it. */
async function pin(root: string): Promise<void> {
  const features = parseFeatures(await downloadText(CERT_URL));
  writeFileSync(join(root, FEATURES_PATH), `${JSON.stringify(features, null, 2)}\n`);
  console.log(`Wrote the ${features.length} features of ${CERT_URL}.`);
}

/** Runs the official packages, as `pnpm conformance` does. */
async function run(root: string, args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { packages: { type: "string" }, reports: { type: "string" }, schemas: { type: "string" } },
  });
  const { packages, reports, schemas = requireSchemas(root) } = values;
  if (packages === undefined || reports === undefined) throw new Error(USAGE);
  const options = { packages: resolve(packages), reports: resolve(reports), schemas };
  const inputs = await runConformance(root, options, await builtModules(root));
  const valid = inputs.filter((input) => input.valid).length;
  console.log(`${valid} of ${inputs.length} inputs are valid; the report is ${join(options.reports, REPORT_FILE)}.`);
}

const USAGE =
  "Usage: pnpm conformance --packages <directory> --reports <directory> [--schemas <directory>] | pnpm conformance:pin";

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command, ...rest] = args;
  if (command === "pin") await pin(root);
  else if (command === "run") await run(root, rest);
  else throw new Error(USAGE);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(messageOf(error));
    process.exit(1);
  });
}
