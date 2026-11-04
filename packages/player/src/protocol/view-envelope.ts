import { definedSchema, mapSchema, nonNegativeIntegerSchema, parseWith, type Schema } from "@assesskit/runtime/checks";
import type { Refusal } from "@assesskit/runtime/delivery";
import * as v from "valibot";
import { type ViewDocuments, viewDocumentsSchema } from "./documents.js";
import { refusalSchema } from "./refusal.js";

/** What a session host answers: the candidate view in the runtime's JSON form, with the sequence number it answers. */
export interface ViewEnvelope {
  /** The sequence number of the request this answers. */
  readonly seq: number;
  /** The view as the runtime's `writeView` writes it. Untrusted until the runtime's `readView` has read it. */
  readonly view: unknown;
  /** Each asset prefix that the view needs, mapped to its base URL; the URL of a package path is the base plus the path. */
  readonly assets: Readonly<Record<string, string>>;
  /**
   * The documents the content of the view comes from, so that a client resolves the references in it against the right
   * path.
   *
   * @defaultValue none, so that every reference resolves against the root of the package
   */
  readonly documents?: ViewDocuments;
  /**
   * Why the engine refused the action this answers, which then left the state as it was.
   *
   * @defaultValue none, the action was applied
   */
  readonly refusal?: Refusal;
}

/**
 * The URLs of the assets by prefix. A prefix is a directory of the package, empty or ending in `/`, as the asset gate signs
 * it, so a name such as `__proto__` is refused and a directory such as `__proto__/` is data; the record of valibot would
 * skip the first unseen.
 */
const assetsSchema = v.pipe(
  mapSchema(v.string()),
  v.check(
    (assets) => [...assets.keys()].every((prefix) => prefix === "" || prefix.endsWith("/")),
    'expected every prefix to be a directory, empty or ending in "/"',
  ),
);

const viewEnvelopeSchema: Schema<unknown> = v.strictObject({
  seq: nonNegativeIntegerSchema,
  view: definedSchema,
  assets: assetsSchema,
  documents: v.optional(viewDocumentsSchema),
  refusal: v.optional(refusalSchema),
});

/**
 * Checks the shape of a view envelope that arrived as JSON.
 *
 * @remarks
 * The view is not read here: the runtime's `readView` reads it.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not an object with the properties `seq`, `view`, `assets` and, optionally, `documents`
 * and `refusal` only, `seq` a non-negative integer, `assets` an object of strings by directories, `documents` the documents of a view
 * and `refusal` a refusal of the runtime.
 */
export function checkViewEnvelope(value: unknown): asserts value is ViewEnvelope {
  parseWith(viewEnvelopeSchema, value, "A view envelope");
}
