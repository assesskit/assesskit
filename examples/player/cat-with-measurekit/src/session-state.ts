import { DataError } from "@assesskit/runtime/errors";
import { checkArray, checkRecord, describe } from "./checks.ts";

/** The seeds are integers below 2³², and the steps of a session below 2²¹, so that `seed × 2²¹ + step` is a safe integer. */
const SEED_LIMIT = 2 ** 32;
const STEP_LIMIT = 2 ** 21;

/**
 * Checks the seed that a host's `seeds` gave for a session.
 *
 * @throws `DataError` when it is not an integer from 0 to 2³² − 1.
 */
export function checkSessionSeed(seed: unknown): asserts seed is number {
  if (!(typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed < SEED_LIMIT)) {
    throw new DataError(`A session seed must be an integer from 0 to ${SEED_LIMIT - 1}, found ${describe(seed)}.`);
  }
}

/**
 * Returns the seed of the random numbers of one step of a session: the step is the number of items administered so far,
 * so the same state always draws the same numbers, and no two steps of any two sessions share a seed.
 *
 * @throws `DataError` when the step is not an integer from 0 to 2²¹ − 1.
 */
export function stepSeed(seed: number, step: number): number {
  if (!(Number.isInteger(step) && step >= 0 && step < STEP_LIMIT)) {
    throw new DataError(`A session has at most ${STEP_LIMIT - 1} steps, found the step ${describe(step)}.`);
  }
  return seed * STEP_LIMIT + step;
}

/**
 * Parses the `sessionState` of a Submit Results request: the JSON text of an object.
 *
 * @throws `DataError` when the state is not the JSON text of an object.
 */
export function parseSessionState(text: unknown): Readonly<Record<string, unknown>> {
  if (typeof text !== "string") {
    throw new DataError(
      `The sessionState must be the text that Create Session or Submit Results gave, found ${describe(text)}.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataError(
      "The sessionState must be the JSON text that Create Session or Submit Results gave, found text that is not JSON.",
    );
  }
  checkRecord(parsed, "The sessionState must hold an object");
  return parsed;
}

/**
 * Reads the progress of a measurekit state: how many items it administered and what it presents next, an item or a module.
 * measurekit checks the rest of the state when it takes the response.
 *
 * @throws `DataError` when the state has no array `items`, or presents nothing next, because the session has ended.
 */
export function readProgress(state: unknown): { readonly administered: number; readonly next: string } {
  checkRecord(state, "The state in the sessionState must be an object");
  const { items, next } = state;
  checkArray(items, "The items in the state of the session must be an array");
  if (typeof next !== "string") {
    throw new DataError(
      `The session presents nothing to take a response, found the next ${describe(next)}; it has ended.`,
    );
  }
  return { administered: items.length, next };
}
