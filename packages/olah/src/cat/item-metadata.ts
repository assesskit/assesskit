import { checkArray, checkOptions, checkRecord, checkString } from "../checks.js";
import { DataError } from "../errors.js";
import {
  checkQtiMetadata,
  type FeedbackType,
  type InteractionType,
  type QtiMetadata,
  type ScoringMode,
} from "../metadata/index.js";
import { checkBytes, encodeBase64 } from "../values/base64.js";

/**
 * A metadata file that is not QTI metadata, such as IEEE LOM (`lom`) or curriculum standards metadata (`csmd`); other
 * types are allowed by agreement (CAT App. B).
 */
export interface CatMetadataFile {
  /** The type of the metadata. */
  readonly type: string;
  /** The content of the file; the metadata JSON holds its base64. */
  readonly content: Uint8Array;
}

/** An item of the pool and what QTI metadata says about it. */
export interface CatPoolItem {
  /** The identifier of the item, the one that the item stages and the results use. It is unique in the pool. */
  readonly identifier: string;
  /** The QTI metadata of the item, for example from `deriveQtiMetadata`. */
  readonly metadata: QtiMetadata;
  /** The metadata of the item of other types. Default: none. */
  readonly externalMetadata?: readonly CatMetadataFile[];
}

/** Options of `catMetadata`. */
export interface CatMetadataOptions {
  /** The metadata of the section as a whole. Default: none. */
  readonly externalMetadata?: readonly CatMetadataFile[];
}

/** A metadata file in the JSON binding (CAT App. B). */
export interface CatExternalMetadata {
  /** The type of the metadata. */
  readonly type: string;
  /** The content of the file, base64-encoded. */
  readonly content: string;
}

/** The metadata of one item in the JSON binding (CAT App. B). A field that the QTI metadata omits is `undefined`. */
export interface CatItemMetadata {
  /** The identifier of the item. */
  readonly identifier: string;
  /** Whether the item is an item template. */
  readonly itemTemplate?: boolean;
  /** Whether the scoring of the item takes the duration of the attempts into account. */
  readonly timeDependent?: boolean;
  /** Whether the item has more than one interaction. */
  readonly composite?: boolean;
  /** The interactions of the item; an empty array says that the item has none. */
  readonly interactionType: readonly InteractionType[];
  /** How the item gives feedback. */
  readonly feedbackType?: FeedbackType;
  /** Whether a model solution is available. */
  readonly solutionAvailable?: boolean;
  /** How the item is scored; absent when the QTI metadata gives none. */
  readonly scoringMode?: readonly ScoringMode[];
  /** The name of the tool that authored the item. */
  readonly toolName?: string;
  /** The version of that tool. */
  readonly toolVersion?: string;
  /** The vendor of that tool. */
  readonly toolVendor?: string;
  /** The metadata of the item of other types; absent when there is none. */
  readonly externalMetadata?: readonly CatExternalMetadata[];
}

/** The metadata of an adaptive section in the JSON binding, the content of the file that `qti-metadata-ref` references (CAT App. B). */
export interface CatMetadata {
  /** The metadata of the section as a whole; absent when there is none. */
  readonly externalMetadata?: readonly CatExternalMetadata[];
  /** The metadata of the items of the pool, in the order given. */
  readonly itemMetadata: readonly CatItemMetadata[];
}

/** Returns the metadata files in the JSON binding; `owner` names what holds them, such as `the option externalMetadata`. */
function externalOf(files: readonly unknown[], owner: string): readonly CatExternalMetadata[] {
  return files.map((file, index) => {
    const position = `at index ${index} of ${owner}`;
    checkRecord(file, `The metadata file ${position} must be an object`);
    checkString(file.type, `The type of the metadata file ${position}`);
    checkBytes(file.content, `The content of the metadata file ${position}`);
    return { type: file.type, content: encodeBase64(file.content) };
  });
}

function itemMetadataOf(item: unknown, index: number, seen: Set<string>): CatItemMetadata {
  checkRecord(item, `The item at index ${index} must be an object`);
  const { identifier, metadata, externalMetadata = [] } = item;
  checkString(identifier, `The identifier of the item at index ${index}`);
  if (seen.has(identifier)) {
    throw new DataError(
      `The identifiers of the items must be unique (CAT App. B), found ${JSON.stringify(identifier)} twice.`,
    );
  }
  seen.add(identifier);
  checkQtiMetadata(metadata);
  checkArray(externalMetadata, `The externalMetadata of the item at index ${index} must be an array`);
  const external = externalOf(externalMetadata, `the item at index ${index}`);
  return {
    identifier,
    itemTemplate: metadata.itemTemplate,
    timeDependent: metadata.timeDependent,
    composite: metadata.composite,
    interactionType: metadata.interactionTypes,
    feedbackType: metadata.feedbackType,
    solutionAvailable: metadata.solutionAvailable,
    scoringMode: metadata.scoringModes.length === 0 ? undefined : metadata.scoringModes,
    toolName: metadata.toolName,
    toolVersion: metadata.toolVersion,
    toolVendor: metadata.toolVendor,
    externalMetadata: external.length === 0 ? undefined : external,
  };
}

/**
 * Builds the metadata of the items of an adaptive section in the JSON binding of CAT Appendix B, which is non-normative.
 * Write it as JSON in UTF-8 to make the file that `qti-metadata-ref` references. The portable custom interaction context
 * of QTI metadata has no field in the binding and is left out.
 *
 * @param items - The items of the pool, each with its QTI metadata.
 * @param options - Default: no metadata of the section as a whole.
 * @throws `DataError` when an argument has the wrong type, the QTI metadata of an item is invalid, a metadata file is not
 * bytes, or two items have one identifier.
 */
export function catMetadata(items: readonly CatPoolItem[], options: CatMetadataOptions = {}): CatMetadata {
  checkArray(items, "The items must be an array");
  checkOptions(options);
  const { externalMetadata = [] } = options;
  checkArray(externalMetadata, "The option externalMetadata must be an array");
  const external = externalOf(externalMetadata, "the option externalMetadata");
  const seen = new Set<string>();
  const itemMetadata = items.map((item, index) => itemMetadataOf(item, index, seen));
  return external.length === 0 ? { itemMetadata } : { externalMetadata: external, itemMetadata };
}
