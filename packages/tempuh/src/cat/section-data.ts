import type { SectionData } from "@luthfanwakan/olah/cat";
import { checkProperties, checkRecord, checkString } from "../checks.js";

const SECTION_DATA_PROPERTIES = ["sectionConfiguration", "qtiUsagedata", "qtiMetadata"];

/**
 * Checks section data, as a host passes it from JavaScript, and returns a copy that has only its fields.
 *
 * @throws `DataError` when it is not an object with the base64 text `sectionConfiguration` and, optionally, the base64
 * text `qtiUsagedata` and `qtiMetadata`.
 */
export function readSectionData(data: unknown): SectionData {
  checkRecord(data, "The section data must be an object");
  checkProperties(data, "The section data", SECTION_DATA_PROPERTIES);
  const { sectionConfiguration, qtiUsagedata, qtiMetadata } = data;
  checkString(sectionConfiguration, "The sectionConfiguration of the section data");
  if (qtiUsagedata !== undefined) checkString(qtiUsagedata, "The qtiUsagedata of the section data");
  if (qtiMetadata !== undefined) checkString(qtiMetadata, "The qtiMetadata of the section data");
  return {
    sectionConfiguration,
    ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }),
    ...(qtiMetadata === undefined ? {} : { qtiMetadata }),
  };
}
