import * as v from "valibot";
import { checkString, mapSchema, parseWith, recordSchema } from "../checks.js";
import { EN_MESSAGES } from "./en.js";
import { ID_MESSAGES } from "./id.js";
import type { Messages } from "./messages.js";

/** The catalogs the player ships, by language. */
const CATALOGS: ReadonlyMap<string, Messages> = new Map([
  ["en", EN_MESSAGES],
  ["id", ID_MESSAGES],
]);

// A catalog of the overrides may have message keys only, and each message is a string. The language tags are data.
const overridesSchema = mapSchema(
  v.pipe(
    recordSchema,
    v.strictObject(Object.fromEntries(Object.keys(EN_MESSAGES).map((key) => [key, v.optional(v.string())]))),
  ),
);

/**
 * Selects the messages for the language of the interface: the English messages, replaced by the shipped catalog of the
 * language, if there is one, and then by the overrides for the language and for the tag in full, which is more specific.
 * A language without a catalog gets English, so every key always has a message.
 *
 * @param language - A BCP 47 language tag, such as `id` or `id-ID`. Case is ignored.
 * @param overrides - Messages that replace the shipped ones, by language tag; a catalog may leave messages out.
 * Default: none.
 * @throws `DataError` when `language` is not a string, `overrides` is not an object of objects, a catalog has a key that is
 * not a message key, or a message is not a string.
 */
export function selectMessages(
  language: string,
  overrides: Readonly<Record<string, Partial<Messages>>> = {},
): Messages {
  checkString(language, "The language");
  const byTag = new Map(
    [...parseWith(overridesSchema, overrides, "The overrides")].map(([tag, catalog]) => [tag.toLowerCase(), catalog]),
  );
  const tag = language.toLowerCase();
  const primary = tag.split("-")[0] ?? tag;
  return { ...EN_MESSAGES, ...CATALOGS.get(primary), ...byTag.get(primary), ...byTag.get(tag) };
}
