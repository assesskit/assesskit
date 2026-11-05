import { looseRecord, parseWith, type Schema, transformWith } from "@assesskit/runtime/checks";
import * as v from "valibot";
import { EN_MESSAGES } from "./en.js";
import type { Messages } from "./messages.js";

const catalogSchema = looseRecord(Object.fromEntries(Object.keys(EN_MESSAGES).map((key) => [key, v.string()])));

/**
 * The messages that passed the check and are frozen, so that they cannot change: a mount checks the messages of each of its
 * parts and an interaction element its own, the catalog has hundreds of keys, and a check of the same object again is skipped.
 */
const CHECKED = new WeakSet<object>();

/**
 * Checks that a value is the messages of the interface: an object with a string for every message of the catalog.
 *
 * @remarks
 * A frozen object that passed is not checked again, such as the messages that `selectMessages` returns.
 *
 * @param messages - The value to check.
 * @throws `DataError` when `messages` is not an object or a message is missing or is not a string.
 */
export function checkMessages(messages: unknown): asserts messages is Messages {
  const known = typeof messages === "object" && messages !== null;
  if (known && CHECKED.has(messages)) return;
  parseWith(catalogSchema, messages, "The option messages");
  if (known && Object.isFrozen(messages)) CHECKED.add(messages);
}

/** The schema of the messages of the interface, which {@link checkMessages} checks, for the options of a mount. */
export const messagesSchema: Schema<Messages> = v.pipe(
  v.unknown(),
  transformWith((messages: unknown): Messages => {
    checkMessages(messages);
    return messages;
  }),
);
