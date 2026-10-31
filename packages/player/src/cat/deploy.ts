import type { AdaptiveSelection } from "@assesskit/runtime/asi";
import { type CatPort, checkPool, type SectionFiles, sectionData } from "@assesskit/runtime/cat";
import { checkFunction, checkRecord, describe } from "@assesskit/runtime/checks";
import { resolveStructure, type SectionNode } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { packageResolvers, type QtiPackage, resourcePath } from "@assesskit/runtime/package";

/** The section that the engine made for an adaptive section: the entry of `DeliveryDefinition.catSections`. */
export interface DeployedCatSection {
  /** The URL prefix of the engine, the `qti-adaptive-engine-ref` of the section. */
  readonly prefix: string;
  /** The identifier that Create Section gave the section. */
  readonly sectionIdentifier: string;
}

/**
 * The resource type of a test in a content package.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/imscp/ | QTI 3.0 Best Practices and Implementation Guide, packaging}
 */
const TEST_RESOURCE = "imsqti_test_xmlv3p0";

/** Returns the bytes of a file that a reference of an adaptive selection names, or none when the selection has no such reference. */
function referencedFile(
  pkg: QtiPackage,
  section: SectionNode,
  reference: { readonly href: string } | undefined,
  what: string,
): Uint8Array | undefined {
  if (reference === undefined) return undefined;
  const path = pkg.resolve(section.base, reference.href);
  const bytes = path === undefined ? undefined : pkg.file(path);
  if (bytes === undefined) {
    throw new DataError(
      `The adaptive section ${describe(section.model.identifier)} references the ${what} ${describe(reference.href)}, which is not a file of the package.`,
    );
  }
  return bytes;
}

/** Reads the files of an adaptive section from the package. A section without settings gets an empty settings file. */
function filesOf(pkg: QtiPackage, section: SectionNode, selection: AdaptiveSelection): SectionFiles {
  const usageData = referencedFile(pkg, section, selection.usagedataRef, "usage data");
  const metadata = referencedFile(pkg, section, selection.metadataRef, "metadata");
  return {
    settings: referencedFile(pkg, section, selection.adaptiveSettingsRef, "settings") ?? new Uint8Array(),
    ...(usageData === undefined ? {} : { usageData }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Returns the adaptive sections of the tests of a package, in document order. */
function adaptiveSections(pkg: QtiPackage): SectionNode[] {
  const resolvers = packageResolvers(pkg);
  return pkg.manifest.resources
    .filter((resource) => resource.type === TEST_RESOURCE)
    .flatMap((resource) => {
      const path = resourcePath(pkg.manifest, resource);
      const document = path === undefined ? undefined : pkg.document(path);
      if (path === undefined || document?.kind !== "test") return [];
      const structure = resolveStructure(document.test, path, resolvers);
      return structure.test.parts.flatMap((part) => part.sections).filter((section) => section.model.adaptiveSelection);
    });
}

/**
 * Deploys the adaptive sections of a package to their engines.
 *
 * @remarks
 * For each adaptive section, it reads the files that its `qti-adaptive-selection` references, makes Create Section with
 * the section data, asks Get Section for the pool of the engine and checks it against the item references of the
 * section. The engine's section identifiers are the result that `DeliveryDefinition.catSections` takes, by the
 * identifier of the section. Create Section is not repeated for a section that already exists, so a host runs this once
 * for a deployment.
 *
 * - **Engine.** `port` returns the engine for a selection, by its `qti-adaptive-engine-ref`; the host decides which
 *   prefixes it trusts.
 * - **Settings.** A selection without `qti-adaptive-settings-ref` sends an empty settings file: the engine is configured
 *   elsewhere.
 * - **Failure.** The sections made before a failure stay; the error names the section and its identifier at the engine,
 *   so that the host can end it with `endSection`.
 *
 * @param pkg - The package that holds the tests.
 * @param port - Returns the engine for an adaptive selection.
 * @returns The sections of the engines by the identifier of the adaptive section.
 * @throws `DataError` when an argument has the wrong type, a referenced file is not in the package, two tests have an
 * adaptive section with the same identifier, or the pool of the engine and the section disagree.
 * @throws `ReadError` and `SecurityError` as `readPackage` documents for a package that cannot be read.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, Create Section and Get Section}
 */
export async function deployCatSections(
  pkg: QtiPackage,
  port: (selection: AdaptiveSelection) => CatPort,
): Promise<ReadonlyMap<string, DeployedCatSection>> {
  checkRecord(pkg, "The package must be an object");
  checkFunction(port, "The port must be a function of an adaptive selection");
  const deployed = new Map<string, DeployedCatSection>();
  for (const section of adaptiveSections(pkg)) {
    const { identifier, adaptiveSelection: selection } = section.model;
    if (selection === undefined) continue;
    if (deployed.has(identifier)) {
      throw new DataError(
        `Two tests of the package have the adaptive section ${describe(identifier)}; the sections of the engine are named by it.`,
      );
    }
    const prefix = selection.adaptiveEngineRef.href;
    const engine = port(selection);
    const { sectionIdentifier } = await engine.createSection(
      prefix,
      sectionData(selection, filesOf(pkg, section, selection)),
    );
    const { items } = await engine.getSection(prefix, sectionIdentifier);
    const issues = checkPool(section.model, items);
    if (issues.length > 0) {
      throw new DataError(
        `The engine's section ${describe(sectionIdentifier)} at ${describe(prefix)} does not agree with the adaptive section ${describe(identifier)}: ${issues.map(({ message }) => message).join(" ")}`,
      );
    }
    deployed.set(identifier, { prefix, sectionIdentifier });
  }
  return deployed;
}
