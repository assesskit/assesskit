import type { PortableCustomInteraction } from "../asi/index.js";
import { checkRecord } from "../checks.js";

/** The module resolution configuration file that is read when `primary-configuration` is absent. */
const DEFAULT_PRIMARY_CONFIGURATION = "modules/module_resolution.js";

/** The fallback configuration file that is read when `secondary-configuration` is absent. */
const DEFAULT_FALLBACK_CONFIGURATION = "modules/fallback_module_resolution.js";

/** The package paths of the two module resolution configuration files of a PCI. */
export interface ModuleConfigurationPaths {
  /** The primary configuration: `primary-configuration` of `qti-interaction-modules`. */
  readonly primary: string;
  /** The fallback configuration: `secondary-configuration` of `qti-interaction-modules`. */
  readonly fallback: string;
}

/**
 * Returns the package paths of the configuration files that a PCI names, or their defaults.
 *
 * @remarks
 * The defaults are `modules/module_resolution.js` and `modules/fallback_module_resolution.js`. Read the files and give
 * their `readModuleResolution` results to `resolvePciModules`.
 *
 * @param interaction - The PCI.
 * @returns The `primary-configuration` and the `secondary-configuration` of its `qti-interaction-modules`, or the
 * defaults.
 * @throws `DataError` when `interaction` is not an object of the model of `qti-portable-custom-interaction`.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
export function resolveModuleConfigurationPaths(interaction: PortableCustomInteraction): ModuleConfigurationPaths {
  checkRecord(interaction, "The interaction must be an object of the model of qti-portable-custom-interaction");
  const modules = interaction.interactionModules;
  return {
    primary: modules?.primaryConfiguration ?? DEFAULT_PRIMARY_CONFIGURATION,
    fallback: modules?.secondaryConfiguration ?? DEFAULT_FALLBACK_CONFIGURATION,
  };
}
