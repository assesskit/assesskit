import type { SectionData } from "@assesskit/runtime/cat";
import { parseWith, type Schema } from "@assesskit/runtime/checks";
import * as v from "valibot";

/** The schema of section data; each field is base64 text. */
const sectionDataSchema: Schema<SectionData> = v.strictObject({
  sectionConfiguration: v.string(),
  qtiUsagedata: v.optional(v.string()),
  qtiMetadata: v.optional(v.string()),
});

/**
 * Checks section data, as a host passes it from JavaScript, and returns a copy that has only its fields.
 *
 * @param data - The section data.
 * @returns A copy of the data.
 * @throws `DataError` when it is not an object with the base64 text `sectionConfiguration` and, optionally, the base64
 * text `qtiUsagedata` and `qtiMetadata`.
 */
export function readSectionData(data: unknown): SectionData {
  return parseWith(sectionDataSchema, data, "The section data");
}
