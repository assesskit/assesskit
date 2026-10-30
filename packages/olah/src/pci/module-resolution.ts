import * as v from "valibot";
import type { PortableCustomInteraction } from "../asi/index.js";
import {
  checkRecord,
  checkString,
  describe,
  mapSchema,
  nonEmptyStringSchema,
  nonNegativeSchema,
  parseWith,
  recordSchema,
  type Schema,
} from "../checks.js";
import { DataError } from "../errors.js";

/** The seconds to wait for a script when a configuration file gives no `waitSeconds` (BPIG §3.7.12.2, App. D). */
export const DEFAULT_WAIT_SECONDS = 7;

/** The module resolution configuration file that is read when `primary-configuration` is absent (BPIG §3.7.12.1). */
const DEFAULT_PRIMARY_CONFIGURATION = "modules/module_resolution.js";

/** The fallback configuration file that is read when `secondary-configuration` is absent (BPIG §3.7.12.3). */
const DEFAULT_FALLBACK_CONFIGURATION = "modules/fallback_module_resolution.js";

/** A module resolution configuration file (BPIG §3.7.12.2, App. D): where the AMD modules of a PCI are. */
export interface ModuleResolution {
  /** Seconds to wait for each script before giving up on a location; 0 means no timeout. Default: {@link DEFAULT_WAIT_SECONDS}. */
  readonly waitSeconds: number;
  /** The location of each module by module id, without the `.js` extension, in the order of the file. */
  readonly paths: ReadonlyMap<string, string>;
}

/** The configuration files of a PCI, loaded: a file that the package lacks is left out. */
export interface PciModuleConfiguration {
  /** The primary configuration, which locates the modules for a normal load. */
  readonly primary?: ModuleResolution;
  /** The fallback configuration, which locates them when the primary location times out or fails. */
  readonly fallback?: ModuleResolution;
}

/** A module that a PCI needs, with the locations to load it from. */
export interface PciModule {
  /** The module id that `require` uses. */
  readonly id: string;
  /** The location to load first, without the `.js` extension; absent when no configuration gives one. */
  readonly primary?: string;
  /** The location to load when the first fails or times out; absent when no configuration gives one. */
  readonly fallback?: string;
  /** Whether the first location to load, the primary one or else the fallback, is a path in the package. */
  readonly packageRelative: boolean;
}

const resolutionSchema: Schema<ModuleResolution> = v.pipe(
  recordSchema,
  v.object({
    waitSeconds: v.optional(nonNegativeSchema, DEFAULT_WAIT_SECONDS),
    paths: v.optional(mapSchema(nonEmptyStringSchema), () => new Map()),
  }),
);

/** Matches the start of a URL with a scheme, such as `https:` (RFC 3986 §3.1). */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Returns whether a module location is a path in the content package. A location that starts with a protocol, such as
 * `https://`, is fetched from there; any other is relative to the package (BPIG §3.7.12.2). A location that starts with
 * `//` names a host and so is not in the package either.
 */
export function isPackageRelative(location: string): boolean {
  return !(SCHEME.test(location) || location.startsWith("//"));
}

/**
 * Reads a module resolution configuration file (BPIG §3.7.12.2, App. D): JSON with `waitSeconds` and `paths`. Other
 * properties are ignored.
 *
 * @param text - The content of the file, such as `modules/module_resolution.js`.
 * @throws `DataError` when the text is not JSON, is not an object, `waitSeconds` is not a non-negative number, or `paths`
 * is not an object of non-empty strings.
 */
export function parseModuleResolution(text: string): ModuleResolution {
  checkString(text, "The module resolution file");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new DataError(
      `The module resolution file must be JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  return parseWith(resolutionSchema, json, "The module resolution file");
}

/** Returns the paths of one loaded configuration file; a file that is absent has none. */
function pathsOf(
  configuration: PciModuleConfiguration,
  which: keyof PciModuleConfiguration,
): ReadonlyMap<string, string> {
  const resolution = configuration[which];
  if (resolution === undefined) return new Map();
  checkRecord(resolution, `The ${which} configuration must be a module resolution`);
  if (!(resolution.paths instanceof Map)) {
    throw new DataError(`The paths of the ${which} configuration must be a Map, found ${describe(resolution.paths)}.`);
  }
  return resolution.paths;
}

/** The package paths of the two module resolution configuration files of a PCI. */
export interface ModuleConfigurationPaths {
  /** The primary configuration: `primary-configuration` of `qti-interaction-modules`. */
  readonly primary: string;
  /** The fallback configuration: `secondary-configuration` of `qti-interaction-modules`. */
  readonly fallback: string;
}

/**
 * Returns the package paths of the configuration files that a PCI names, or their defaults: the `primary-configuration`
 * of its `qti-interaction-modules`, `modules/module_resolution.js` by default, and the `secondary-configuration`,
 * `modules/fallback_module_resolution.js` by default (BPIG §3.7.12.1–4). Read the files and give their
 * {@link parseModuleResolution}s to {@link resolvePciModules}.
 *
 * @throws `DataError` when `interaction` is not an object of the model of `qti-portable-custom-interaction`.
 */
export function moduleConfigurationPaths(interaction: PortableCustomInteraction): ModuleConfigurationPaths {
  checkRecord(interaction, "The interaction must be an object of the model of qti-portable-custom-interaction");
  const modules = interaction.interactionModules;
  return {
    primary: modules?.primaryConfiguration ?? DEFAULT_PRIMARY_CONFIGURATION,
    fallback: modules?.secondaryConfiguration ?? DEFAULT_FALLBACK_CONFIGURATION,
  };
}

/**
 * Lists the modules a PCI loads and where each one is (BPIG §3.7.12.2–4): the module named by the `module` attribute, the
 * `qti-interaction-module`s in the order of the document, and then the modules that only the configurations name, which
 * are the dependencies of the PCI's modules. A `primary-path` or `fallback-path` of a `qti-interaction-module` replaces the
 * location in the configuration. The host requires the module of the `module` attribute or, when it is absent, those of
 * `qti-interaction-modules`, and gives the rest to its loader as paths, with {@link ModuleResolution.waitSeconds} of the
 * primary configuration as the timeout.
 *
 * @param interaction - The PCI.
 * @param configuration - The configuration files that {@link moduleConfigurationPaths} names, parsed; a file that the
 * package lacks is left out.
 * @returns One entry for each module id, each id once.
 * @throws `DataError` when an argument has the wrong type.
 */
export function resolvePciModules(
  interaction: PortableCustomInteraction,
  configuration: PciModuleConfiguration,
): readonly PciModule[] {
  checkRecord(interaction, "The interaction must be an object of the model of qti-portable-custom-interaction");
  checkRecord(configuration, "The configuration must be an object with the optional properties primary and fallback");
  const primary = pathsOf(configuration, "primary");
  const fallback = pathsOf(configuration, "fallback");
  const listed = interaction.interactionModules?.interactionModules ?? [];
  const overrides = new Map(listed.map((module) => [module.id, module]));
  const ids = new Set([
    ...(interaction.module === undefined ? [] : [interaction.module]),
    ...overrides.keys(),
    ...primary.keys(),
    ...fallback.keys(),
  ]);
  return [...ids].map((id): PciModule => {
    const override = overrides.get(id);
    const primaryPath = override?.primaryPath ?? primary.get(id);
    const fallbackPath = override?.fallbackPath ?? fallback.get(id);
    const first = primaryPath ?? fallbackPath;
    return {
      id,
      ...(primaryPath === undefined ? {} : { primary: primaryPath }),
      ...(fallbackPath === undefined ? {} : { fallback: fallbackPath }),
      packageRelative: first !== undefined && isPackageRelative(first),
    };
  });
}
