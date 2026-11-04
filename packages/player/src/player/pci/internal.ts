/**
 * The frame of a portable custom interaction: what the mounts draw it with and the tests use.
 *
 * @remarks
 * The package does not export it: `mountItem` and `mountDelivery` host each interaction in a frame.
 *
 * @module
 */

export { buildFrameCsp } from "./csp.js";
export { describeFrame } from "./describe-frame.js";
export {
  checkVariable,
  createResponseDecoder,
  encodeVariable,
  type PciFiles,
  type PciVariable,
  responseKey,
} from "./files.js";
export { MAX_PCI_HEIGHT, MIN_PCI_HEIGHT, mountPciFrame, type PciFrame } from "./host.js";
export { pciModules } from "./modules.js";
export type { PciEvent, PciFrameOptions } from "./options.js";
export { isRequestedStatus, type PciFrameMessage, type PciStatus } from "./protocol.js";
export { readFrameMessage, toJson } from "./read-message.js";
