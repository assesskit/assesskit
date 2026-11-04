/**
 * What the modules of the interactions share in the frame of a portable custom interaction: the AMD definition, the
 * configuration that the delivery engine passes, and the event of a changed response. Nothing here is exported by the package.
 */
export { defineInteraction, type InstanceArguments, notifyChange, type PciInstance, takesInput } from "./pci.js";
