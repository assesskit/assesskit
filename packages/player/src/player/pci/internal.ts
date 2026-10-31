/**
 * Helpers of the portable custom interaction host that its tests use.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */

export { checkPciFrameOptions } from "./check-options.js";
export { buildFrameCsp } from "./csp.js";
export { describeFrame } from "./describe-frame.js";
export { checkVariable, createResponseDecoder, encodeVariable } from "./files.js";
export { pciModules } from "./modules.js";
export { isRequestedStatus, type PciFrameMessage } from "./protocol.js";
export { readFrameMessage, toJson } from "./read-message.js";
