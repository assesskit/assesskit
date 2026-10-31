import type { AdaptiveSelection } from "../asi/index.js";
import { checkBytes, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { encodeBase64 } from "../values/base64.js";
import type { SectionData } from "./model.js";

/** The files that the references of a `qti-adaptive-selection` name, as bytes (CAT §2.2). */
export interface SectionFiles {
  /** The settings file, which `qti-adaptive-settings-ref` references. */
  readonly settings: Uint8Array;
  /** The usage data file, which `qti-usagedata-ref` references; required exactly when the selection has that reference. */
  readonly usageData?: Uint8Array;
  /** The metadata file, which `qti-metadata-ref` references; required exactly when the selection has that reference. */
  readonly metadata?: Uint8Array;
}

/** An optional file of a section: its name in `SectionFiles`, the property of the selection and the element that name it. */
interface OptionalFile {
  readonly file: "usageData" | "metadata";
  readonly reference: "usagedataRef" | "metadataRef";
  readonly element: string;
}

const USAGE_DATA: OptionalFile = { file: "usageData", reference: "usagedataRef", element: "qti-usagedata-ref" };
const METADATA: OptionalFile = { file: "metadata", reference: "metadataRef", element: "qti-metadata-ref" };

/** Returns the base64 of an optional file, which the files hold exactly when the selection references it (CAT §4.1). */
function encodeOptional(
  selection: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, unknown>>,
  { file, reference, element }: OptionalFile,
): string | undefined {
  const referenced = selection[reference];
  const content = files[file];
  if (referenced === undefined) {
    if (content !== undefined) {
      throw new DataError(
        `The selection has no ${element}, so the file ${file} must be omitted (CAT §4.1), found ${describe(content)}.`,
      );
    }
    return undefined;
  }
  checkRecord(referenced, `The ${element} of the selection must be an object`);
  if (content === undefined) {
    throw new DataError(`The selection has a ${element}, so the file ${file} is required (CAT §4.1), found nothing.`);
  }
  checkBytes(content, `The file ${file}`);
  return encodeBase64(content);
}

/**
 * Builds the section data of the Create Section request from the files of an adaptive section: the base64 of each file
 * (CAT §2.2, §4.1). The settings file is always sent. The usage data and the metadata are sent when the selection
 * references them, and only then, so the files must agree with the references. The usage data is the file that
 * `writeUsageData` writes, and the metadata the JSON of `catMetadata`.
 *
 * @param selection - The `qti-adaptive-selection` of the section.
 * @param files - The content of the referenced files.
 * @throws `DataError` when an argument has the wrong type, a file is not bytes, or `usageData` or `metadata` is missing
 * for a reference or present without one.
 */
export function sectionData(selection: AdaptiveSelection, files: SectionFiles): SectionData {
  const input: unknown = selection;
  checkRecord(input, "The selection must be an object");
  if (input.kind !== "adaptive-selection") {
    throw new DataError(`The selection must be a qti-adaptive-selection, found the kind ${describe(input.kind)}.`);
  }
  const received: unknown = files;
  checkRecord(received, "The files must be an object");
  const { settings } = received;
  checkBytes(settings, "The file settings");
  const qtiUsagedata = encodeOptional(input, received, USAGE_DATA);
  const qtiMetadata = encodeOptional(input, received, METADATA);
  return {
    sectionConfiguration: encodeBase64(settings),
    ...(qtiUsagedata === undefined ? {} : { qtiUsagedata }),
    ...(qtiMetadata === undefined ? {} : { qtiMetadata }),
  };
}
