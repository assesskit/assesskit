import { checkProperties, checkRecord, checkString, describe } from "../checks.js";
import { EN_MESSAGES } from "./en.js";
import { ID_MESSAGES } from "./id.js";
import type { Messages } from "./messages.js";

/** The catalogs tempuh ships, by language. */
const CATALOGS: ReadonlyMap<string, Messages> = new Map([
  ["en", EN_MESSAGES],
  ["id", ID_MESSAGES],
]);

/** The message keys, which a catalog of the overrides may have. */
const MESSAGE_KEYS = Object.keys(EN_MESSAGES);

/** Reads the overrides by language tag: each catalog may have message keys only, and each message is a string. */
function readOverrides(
  overrides: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, Readonly<Record<string, string>>> {
  const byTag = new Map<string, Readonly<Record<string, string>>>();
  for (const [tag, catalog] of Object.entries(overrides)) {
    checkRecord(catalog, `The overrides for the language ${describe(tag)} must be an object`);
    checkProperties(catalog, `The catalog for the language ${describe(tag)}`, MESSAGE_KEYS);
    const messages: Record<string, string> = {};
    for (const [key, text] of Object.entries(catalog)) {
      checkString(text, `The message ${describe(key)} for the language ${describe(tag)}`);
      messages[key] = text;
    }
    byTag.set(tag.toLowerCase(), messages);
  }
  return byTag;
}

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
  checkRecord(overrides, "The overrides must be an object");
  const byTag = readOverrides(overrides);
  const tag = language.toLowerCase();
  const primary = tag.split("-")[0] ?? tag;
  return { ...EN_MESSAGES, ...CATALOGS.get(primary), ...byTag.get(primary), ...byTag.get(tag) };
}
