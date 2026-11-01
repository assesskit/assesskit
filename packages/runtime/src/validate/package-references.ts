import {
  type AsiDocument,
  type AssessmentItem,
  descendantNodes,
  type ModelNode,
  type PortableCustomInteraction,
  walkDocument,
} from "../asi/index.js";
import { isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import {
  checkPortableInteraction,
  isPackageRelative,
  moduleConfigurationPaths,
  type PciModule,
  type PciModuleConfiguration,
  parseModuleResolution,
  resolvePciModules,
} from "../pci/index.js";
import type { Findings } from "./findings.js";
import { elementPath } from "./model-access.js";
import type { Contents } from "./package-files.js";

/** The extension of a module file, which the module resolution files leave out of a path. */
const MODULE_EXTENSION = ".js";

/**
 * Checks the configuration files of the adaptive sections of a document: a settings, usage data or metadata
 * file that the section names with a relative address must be in the package and listed in the manifest. An address with
 * a scheme names a service or a file elsewhere and is not checked, and neither is the address of the CAT engine.
 *
 * @param contents - The files of the package.
 * @param findings - The findings of the document, which receive the issues.
 * @param document - A test or section.
 * @param path - The path of the document, against which the addresses resolve.
 */
export function checkAdaptiveFiles(contents: Contents, document: AsiDocument, path: string, findings: Findings): void {
  walkDocument(document, (visit) => {
    if (visit.name !== "qti-adaptive-selection") return;
    for (const property of ["adaptiveSettingsRef", "usagedataRef", "metadataRef"] as const) {
      const ref = visit.model[property];
      const href = isRecord(ref) && typeof ref.href === "string" ? ref.href : undefined;
      if (href === undefined || !isPackageRelative(href)) continue;
      const what = `The ${property.replace(/Ref$/, "")} file of the adaptive section`;
      contents.check(contents.pkg.resolve(path, href), what, findings, `${elementPath(visit)}/${property}`);
    }
  });
}

function isPortableCustomInteraction(node: ModelNode): node is PortableCustomInteraction {
  return node.kind === "portable-custom-interaction";
}

/**
 * The base of the locations of a portable custom interaction: its configuration files and its modules are paths in the
 * content package, whichever folder holds the item.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, InteractionModules}
 */
const PACKAGE_ROOT = "";

/** Reads a module resolution file from the package; `undefined` when the package has none or it cannot be read. */
function readConfiguration(
  contents: Contents,
  location: string,
  findings: Findings,
): PciModuleConfiguration["primary"] {
  const path = contents.pkg.resolve(PACKAGE_ROOT, location);
  const bytes = path === undefined ? undefined : contents.pkg.file(path);
  if (path === undefined || bytes === undefined) return undefined;
  contents.check(
    path,
    "A module resolution file of a portable custom interaction",
    findings,
    "qti-portable-custom-interaction",
  );
  try {
    return parseModuleResolution(new TextDecoder().decode(bytes));
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    findings.error(
      "assesskit/validate/module-resolution",
      `The module resolution file ${JSON.stringify(path)} is not valid: ${error.message}`,
      "qti-portable-custom-interaction",
    );
    return undefined;
  }
}

/** Returns the path of the file a module location names: the location as written, or with the extension its paths leave out. */
function moduleFile(contents: Contents, location: string): string | undefined {
  const direct = contents.pkg.resolve(PACKAGE_ROOT, location);
  if (direct !== undefined && contents.has(direct)) return direct;
  return location.endsWith(MODULE_EXTENSION)
    ? direct
    : contents.pkg.resolve(PACKAGE_ROOT, `${location}${MODULE_EXTENSION}`);
}

/**
 * Checks the files of a module at package-relative locations: the module needs one of them, because the fallback is for the
 * location that fails, and each one that is there must be listed.
 */
function checkModuleFiles(contents: Contents, module: PciModule, findings: Findings): void {
  const files = [module.primary, module.fallback].flatMap((location) =>
    location !== undefined && isPackageRelative(location) ? [moduleFile(contents, location)] : [],
  );
  const present = files.filter((path) => path !== undefined && contents.has(path));
  const what = `The file of the module ${JSON.stringify(module.id)}`;
  const element = "qti-portable-custom-interaction";
  if (files.length > 0 && present.length === 0) contents.check(files[0], what, findings, element);
  for (const path of present) contents.check(path, what, findings, element);
}

/**
 * Checks the portable custom interactions of an item against the package: that each names modules which a module
 * resolution file or its own paths locate and that the module files at package-relative locations, and
 * the resolution files, are in the package and listed in the manifest. A location is a path from the root of the package,
 * not from the folder of the item. A location with a scheme is fetched from there and is not checked.
 *
 * @param contents - The files of the package.
 * @param item - The item.
 * @param findings - The findings of the document, which receive the issues.
 */
export function checkPciFiles(contents: Contents, item: AssessmentItem, findings: Findings): void {
  for (const interaction of descendantNodes(item).filter(isPortableCustomInteraction)) {
    const paths = moduleConfigurationPaths(interaction);
    const configuration: PciModuleConfiguration = {
      primary: readConfiguration(contents, paths.primary, findings),
      fallback: readConfiguration(contents, paths.fallback, findings),
    };
    findings.adopt(checkPortableInteraction(interaction, configuration));
    // The modules that only a configuration names are loaded when another module requires them, which only the code can say.
    const named = new Set([
      ...(interaction.module === undefined ? [] : [interaction.module]),
      ...(interaction.interactionModules?.interactionModules ?? []).map(({ id }) => id),
    ]);
    for (const module of resolvePciModules(interaction, configuration).filter(({ id }) => named.has(id))) {
      checkModuleFiles(contents, module, findings);
    }
  }
}
