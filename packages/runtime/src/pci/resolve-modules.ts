import type { PortableCustomInteraction } from "../asi/index.js";
import { checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { ModuleResolution } from "./module-resolution.js";
import { isPackageRelative } from "./package-relative.js";

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

/**
 * Lists the modules a PCI loads and where each one is.
 *
 * @remarks
 * The list holds the module named by the `module` attribute, the `qti-interaction-module`s in the order of the
 * document, and then the modules that only the configurations name, which are the dependencies of the PCI's modules. A
 * `primary-path` or `fallback-path` of a `qti-interaction-module` replaces the location in the configuration. The host
 * requires the module of the `module` attribute or, when it is absent, those of `qti-interaction-modules`, and gives
 * the rest to its loader as paths, with `waitSeconds` of the primary configuration as the timeout.
 *
 * @param interaction - The PCI.
 * @param configuration - The configuration files that `resolveModuleConfigurationPaths` names, parsed; a file that the package
 * lacks is left out.
 * @returns One entry for each module id, each id once.
 * @throws `DataError` when an argument has the wrong type.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
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
