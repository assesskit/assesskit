/**
 * The portable custom interaction support of a delivery engine: the JSON binding of variable values with file
 * callbacks, module resolution, the properties passed to a module, and checks of a PCI.
 *
 * @module @assesskit/runtime/pci
 */
export { checkPortableInteraction } from "./check.js";
export { type ModuleConfigurationPaths, moduleConfigurationPaths } from "./configuration-paths.js";
export { decodePciValue } from "./decode.js";
export { encodePciValue } from "./encode.js";
export type { PciFileLoader, PciFileStore } from "./file-callbacks.js";
export { DEFAULT_WAIT_SECONDS, type ModuleResolution, parseModuleResolution } from "./module-resolution.js";
export { isPackageRelative } from "./package-relative.js";
export type { PciJson } from "./pci-json.js";
export { pciProperties } from "./properties.js";
export { type PciModule, type PciModuleConfiguration, resolvePciModules } from "./resolve-modules.js";
