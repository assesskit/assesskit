/**
 * The portable custom interaction support of a delivery engine: the JSON binding of variable values (BPIG App. C) with
 * file callbacks, module resolution (BPIG §3.7.12.2, App. D), the properties passed to a module, and checks of a PCI.
 *
 * @module @luthfanwakan/olah/pci
 */
export { checkPortableInteraction } from "./check.js";
export { decodePciValue, encodePciValue, type PciFileLoader, type PciFileStore, type PciJson } from "./codec.js";
export {
  DEFAULT_WAIT_SECONDS,
  isPackageRelative,
  type ModuleConfigurationPaths,
  type ModuleResolution,
  moduleConfigurationPaths,
  type PciModule,
  type PciModuleConfiguration,
  parseModuleResolution,
  resolvePciModules,
} from "./module-resolution.js";
export { pciProperties } from "./properties.js";
