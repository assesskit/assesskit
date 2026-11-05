import { looseRecord, parseWith, type Schema, transformWith } from "@assesskit/runtime/checks";
import * as v from "valibot";
import { EN_MESSAGES } from "./en.js";
import type { Messages } from "./messages.js";

const catalogSchema = looseRecord(Object.fromEntries(Object.keys(EN_MESSAGES).map((key) => [key, v.string()])));

/**
 * Checks that a value is the messages of the interface: an object with a string for every message of the catalog.
 *
 * @param messages - The value to check.
 * @throws `DataError` when `messages` is not an object or a message is missing or is not a string.
 */
export function checkMessages(messages: unknown): asserts messages is Messages {
  parseWith(catalogSchema, messages, "The option messages");
}

/** The schema of the messages of the interface, which {@link checkMessages} checks, for the options of a mount. */
export const messagesSchema: Schema<Messages> = v.pipe(
  v.unknown(),
  transformWith((messages: unknown): Messages => {
    checkMessages(messages);
    return messages;
  }),
);
