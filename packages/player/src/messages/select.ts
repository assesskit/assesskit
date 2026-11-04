import { checkString, mapSchema, parseWith, recordSchema } from "@assesskit/runtime/checks";
import * as v from "valibot";
import { EN_MESSAGES } from "./en.js";
import type { Messages } from "./messages.js";

// A catalog may have message keys only, and each message is a string. The language tags are data.
const catalogsSchema = mapSchema(
  v.pipe(
    recordSchema,
    v.strictObject(Object.fromEntries(Object.keys(EN_MESSAGES).map((key) => [key, v.optional(v.string())]))),
  ),
);

/** The options of {@link selectMessages}. */
export interface SelectMessagesOptions {
  /**
   * The catalogs of the host by language tag; a catalog may leave messages out, and one for a tag may change a few messages
   * of the one for its language.
   *
   * @defaultValue None, so that the messages are English
   */
  readonly catalogs?: Readonly<Record<string, Partial<Messages>>>;
}

const optionsSchema = v.pipe(recordSchema, v.strictObject({ catalogs: v.optional(v.unknown()) }));

/**
 * Selects the messages for the language of the interface.
 *
 * @remarks
 * The result is the English messages, replaced by the catalog that the host gives for the language, and then by the one for
 * the tag in full, which is more specific. A language without a catalog gets English, so every key has a message. The
 * player ships English only; the catalog of another language is a module of its own, such as
 * `@assesskit/player/messages-id`, which the host imports and passes here, so that a host loads only the languages it shows.
 *
 * @param language - A BCP 47 language tag, such as `id` or `id-ID`. Case is ignored.
 * @param options - See {@link SelectMessagesOptions}.
 * @returns The messages.
 * @throws `DataError` when `language` is not a string, `options` has another property than `catalogs`, `catalogs` is not an
 * object of objects, a catalog has a key that is not a message key, or a message is not a string.
 * @see {@link https://www.rfc-editor.org/rfc/rfc5646 | RFC 5646, tags for identifying languages}
 */
export function selectMessages(language: string, options: SelectMessagesOptions = {}): Messages {
  checkString(language, "The language");
  const { catalogs = {} } = parseWith(optionsSchema, options, "The options");
  const byTag = new Map(
    [...parseWith(catalogsSchema, catalogs, "The catalogs")].map(([tag, catalog]) => [tag.toLowerCase(), catalog]),
  );
  const tag = language.toLowerCase();
  const primary = tag.split("-")[0] ?? tag;
  return { ...EN_MESSAGES, ...byTag.get(primary), ...byTag.get(tag) };
}
