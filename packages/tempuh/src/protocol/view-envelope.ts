import type { Refusal } from "@luthfanwakan/olah/delivery";
import * as v from "valibot";
import { definedSchema, mapSchema, nonNegativeIntegerSchema, parseWith, type Schema } from "../checks.js";
import { type ViewDocuments, viewDocumentsSchema } from "./documents.js";
import { refusalSchema } from "./refusal.js";

/** What a session host answers: the candidate view in olah's JSON form, with the sequence number it answers. */
export interface ViewEnvelope {
  /** The sequence number of the request this answers. */
  readonly seq: number;
  /** The view as olah's `viewToJson` writes it. Untrusted until olah's `viewFromJson` has read it. */
  readonly view: unknown;
  /** Each asset prefix that the view needs, mapped to its base URL; the URL of a package path is the base plus the path. */
  readonly assets: Readonly<Record<string, string>>;
  /**
   * The documents the content of the view comes from, so that a client resolves the references in it against the right
   * path. Default: none, so that every reference resolves against the root of the package.
   */
  readonly documents?: ViewDocuments;
  /** Why the engine refused the action this answers, which then left the state as it was. Default: none, the action was applied. */
  readonly refusal?: Refusal;
}

const viewEnvelopeSchema: Schema<unknown> = v.strictObject({
  seq: nonNegativeIntegerSchema,
  view: definedSchema,
  // The prefixes are data, `__proto__` included, so the record of valibot, which skips such a name, does not read them.
  assets: mapSchema(v.string()),
  documents: v.optional(viewDocumentsSchema),
  refusal: v.optional(refusalSchema),
});

/**
 * Checks the shape of a view envelope that arrived as JSON. The view is not read: that is `viewFromJson`.
 *
 * @throws `DataError` when it is not an object with the properties `seq`, `view`, `assets` and, optionally, `documents`
 * and `refusal` only, `seq` a non-negative integer, `assets` an object of strings, `documents` the documents of a view
 * and `refusal` a refusal of olah.
 */
export function checkViewEnvelope(value: unknown): asserts value is ViewEnvelope {
  parseWith(viewEnvelopeSchema, value, "A view envelope");
}
