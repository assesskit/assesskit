import type { SectionData } from "@assesskit/runtime/cat";
import { parseWith } from "@assesskit/runtime/checks";
import { checkQtiMetadata } from "@assesskit/runtime/metadata";
import * as v from "valibot";

/** The schema of section data; each file is base64 text, and the metadata record is checked after the parse. */
const sectionDataSchema = v.strictObject({
  sectionConfiguration: v.string(),
  qtiUsagedata: v.optional(v.string()),
  qtiMetadata: v.optional(v.string()),
  qtiMetadataRecord: v.optional(v.unknown()),
});

/**
 * Checks section data, as a host passes it from JavaScript, and returns a copy that has only its fields.
 *
 * @param data - The section data.
 * @returns A copy of the data.
 * @throws `DataError` when it is not an object with the base64 text `sectionConfiguration` and, optionally, the base64
 * text `qtiUsagedata` and `qtiMetadata`, and the QTI metadata `qtiMetadataRecord`.
 */
export function readSectionData(data: unknown): SectionData {
  const { sectionConfiguration, qtiUsagedata, qtiMetadata, qtiMetadataRecord } = parseWith(
    sectionDataSchema,
    data,
    "The section data",
  );
  if (qtiMetadataRecord !== undefined) checkQtiMetadata(qtiMetadataRecord);
  return {
    sectionConfiguration,
    ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }),
    ...(qtiMetadata === undefined ? {} : { qtiMetadata }),
    ...(qtiMetadataRecord === undefined ? {} : { qtiMetadataRecord }),
  };
}
