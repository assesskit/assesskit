/**
 * What the asset gate of the session host is made of: the gate, the asset prefixes that a view needs, and the documents
 * that its content comes from.
 *
 * @module
 */
export { locateDocuments } from "./documents.js";
export {
  type AssetGate,
  type AssetGateOptions,
  createAssetGate,
  DEFAULT_TTL_SECONDS,
  DEFAULT_UPLOAD_TTL_SECONDS,
  type GateResponse,
} from "./gate.js";
export { collectAssetPrefixes } from "./prefixes.js";
