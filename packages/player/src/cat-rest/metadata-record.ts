// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.

import { recordSchema, type Schema, strictRecord } from "@assesskit/runtime/checks";
import {
  checkQtiMetadata,
  FEEDBACK_TYPES,
  INTERACTION_TYPES,
  type PciContext,
  type QtiMetadata,
  SCORING_MODES,
} from "@assesskit/runtime/metadata";
import * as v from "valibot";

/** The longest tool name, version or vendor, in characters: `String256` of the binding. */
const MAX_TOOL_STRING_LENGTH = 256;

const toolStringSchema = v.pipe(
  v.string(),
  v.check(
    (text) => [...text].length <= MAX_TOOL_STRING_LENGTH,
    () => `expected at most ${MAX_TOOL_STRING_LENGTH} characters`,
  ),
);

const pciContextEntries = {
  customTypeIdentifier: v.optional(v.string()),
  interactionKind: v.optional(v.string()),
};

/** The fields of the `QTIMetadataDType` of the binding (section 5.3.8), with the schema of the portable custom interaction context. */
function metadataEntries(pciContext: Schema<PciContext>) {
  return {
    itemTemplate: v.optional(v.boolean()),
    timeDependent: v.optional(v.boolean()),
    composite: v.optional(v.boolean()),
    interactionType: v.optional(v.array(v.picklist(INTERACTION_TYPES))),
    portableCustomInteractionContext: v.optional(pciContext),
    feedbackType: v.optional(v.picklist(FEEDBACK_TYPES)),
    solutionAvailable: v.optional(v.boolean()),
    scoringMode: v.optional(v.array(v.picklist(SCORING_MODES))),
    toolName: v.optional(toolStringSchema),
    toolVersion: v.optional(toolStringSchema),
    toolVendor: v.optional(toolStringSchema),
  };
}

/** Reads the lists that the binding leaves out as empty, and names them as the QTI metadata record does. */
function asRecord({
  interactionType,
  scoringMode,
  ...fields
}: v.InferOutput<v.ObjectSchema<ReturnType<typeof metadataEntries>, undefined>>): QtiMetadata {
  return { ...fields, interactionTypes: interactionType ?? [], scoringModes: scoringMode ?? [] };
}

/**
 * The `QTIMetadataDType` of the binding, read as a QTI metadata record, in a request: the schema has
 * `additionalProperties: false`, so a property that it does not name is refused.
 */
export const metadataRecordSchema: Schema<QtiMetadata> = v.pipe(
  strictRecord(metadataEntries(strictRecord(pciContextEntries))),
  v.transform(asRecord),
);

/** The same record in an answer, in which a property that the schema does not name is left out, as the engine may add one. */
export const metadataRecordAnswerSchema: Schema<QtiMetadata> = v.pipe(
  recordSchema,
  v.object(metadataEntries(v.pipe(recordSchema, v.object(pciContextEntries)))),
  v.transform(asRecord),
);

/**
 * Returns the `qtiMetadata` object of the binding for a QTI metadata record: the lists that are empty are left out, as the
 * binding's optional arrays are.
 *
 * @throws `DataError` when the record is not QTI metadata.
 */
export function writeMetadataRecord(record: unknown): unknown {
  checkQtiMetadata(record);
  const { interactionTypes, scoringModes, ...fields } = record;
  return {
    ...fields,
    ...(interactionTypes.length === 0 ? {} : { interactionType: interactionTypes }),
    ...(scoringModes.length === 0 ? {} : { scoringMode: scoringModes }),
  };
}
