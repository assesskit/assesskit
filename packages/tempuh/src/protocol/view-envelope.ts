import { checkNonNegativeInteger, checkProperties, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** What a session host answers: the candidate view in olah's JSON form, with the sequence number it answers. */
export interface ViewEnvelope {
  /** The sequence number of the request this answers. */
  readonly seq: number;
  /** The view as olah's `viewToJson` writes it. Untrusted until olah's `viewFromJson` has read it. */
  readonly view: unknown;
  /** Each asset prefix that the view needs, mapped to its base URL; the URL of a package path is the base plus the path. */
  readonly assets: Readonly<Record<string, string>>;
}

/**
 * Checks the shape of a view envelope that arrived as JSON. The view is not read: that is `viewFromJson`.
 *
 * @throws `DataError` when it is not an object with the properties `seq`, `view` and `assets` only, `seq` a non-negative
 * integer and `assets` an object of strings.
 */
export function checkViewEnvelope(value: unknown): asserts value is ViewEnvelope {
  checkRecord(value, "A view envelope must be an object");
  checkProperties(value, "A view envelope", ["seq", "view", "assets"]);
  checkNonNegativeInteger(value.seq, "The property seq of a view envelope");
  if (value.view === undefined) throw new DataError('A view envelope must have the property "view".');
  const { assets } = value;
  checkRecord(assets, "The property assets of a view envelope must be an object");
  for (const [prefix, base] of Object.entries(assets)) {
    checkString(base, `The base URL of the asset prefix ${describe(prefix)}`);
  }
}
