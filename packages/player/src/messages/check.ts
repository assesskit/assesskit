import { looseRecord, parseWith } from "@assesskit/runtime/checks";
import * as v from "valibot";
import { EN_MESSAGES } from "./en.js";
import type { Messages } from "./messages.js";

const messagesSchema = looseRecord(Object.fromEntries(Object.keys(EN_MESSAGES).map((key) => [key, v.string()])));

/**
 * Checks that a value is the messages of the interface: an object with a string for every message of the catalog.
 *
 * @param messages - The value to check.
 * @throws `DataError` when `messages` is not an object or a message is missing or is not a string.
 */
export function checkMessages(messages: unknown): asserts messages is Messages {
  parseWith(messagesSchema, messages, "The option messages");
}
