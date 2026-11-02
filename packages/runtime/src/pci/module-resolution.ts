import * as v from "valibot";
import {
  checkString,
  mapSchema,
  nonEmptyStringSchema,
  nonNegativeSchema,
  parseWith,
  recordSchema,
  type Schema,
} from "../checks.js";
import { DataError } from "../errors.js";

/**
 * The seconds to wait for a script when a configuration file gives no `waitSeconds`.
 *
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
export const DEFAULT_WAIT_SECONDS = 7;

/**
 * The longest module resolution file that is read, in UTF-16 code units: a hundred times the largest of the 1EdTech examples
 * (663), room for hundreds of modules. The file comes from a package, and the memory of `JSON.parse` follows its tokens:
 * a file of the 512 MiB that a package entry may hold would parse into tens of gigabytes.
 */
const MAX_LENGTH = 65_536;

/**
 * A module resolution configuration file: where the AMD modules of a PCI are.
 *
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
export interface ModuleResolution {
  /**
   * Seconds to wait for each script before giving up on a location; 0 means no timeout.
   *
   * @defaultValue {@link DEFAULT_WAIT_SECONDS}
   */
  readonly waitSeconds: number;
  /** The location of each module by module id, without the `.js` extension, in the order of the file. */
  readonly paths: ReadonlyMap<string, string>;
}

const resolutionSchema: Schema<ModuleResolution> = v.pipe(
  recordSchema,
  v.object({
    waitSeconds: v.optional(nonNegativeSchema, DEFAULT_WAIT_SECONDS),
    paths: v.optional(mapSchema(nonEmptyStringSchema), () => new Map()),
  }),
);

/**
 * Reads a module resolution configuration file: JSON with `waitSeconds` and `paths`.
 *
 * @remarks
 * Other properties are ignored. A text longer than 65,536 code units is refused before it is parsed.
 *
 * @param text - The content of the file, such as `modules/module_resolution.js`.
 * @returns The configuration, with the default `waitSeconds` and no paths when the file omits them.
 * @throws `DataError` when the text is longer than 65,536 code units, is not JSON, is not an object, `waitSeconds` is not
 * a non-negative number, or `paths` is not an object of non-empty strings.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
export function parseModuleResolution(text: string): ModuleResolution {
  checkString(text, "The module resolution file");
  if (text.length > MAX_LENGTH) {
    throw new DataError(
      `The module resolution file has ${text.length} characters, more than the ${MAX_LENGTH} that a module resolution file may have.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new DataError(
      `The module resolution file must be JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  return parseWith(resolutionSchema, json, "The module resolution file");
}
