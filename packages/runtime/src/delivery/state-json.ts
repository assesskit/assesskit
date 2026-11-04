import * as v from "valibot";
import { checkString, finiteSchema, parseWith, positiveIntegerSchema, type Schema, transformWith } from "../checks.js";
import { nonNegativeSchema } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { PNP_HAZARDS, type TestingTime } from "../pnp/index.js";
import { restoreRandom } from "../random.js";
import {
  type CandidateNeeds,
  checkState,
  type DeliveredItem,
  type DeliveryState,
  EXPIRIES,
  type ScopeClock,
  STATE_VERSION,
} from "./delivery-state.js";
import { valuesSchema, valuesToJson } from "./entries-json.js";
import { itemKeySchema } from "./item-key.js";
import { itemSessionSchema, itemSessionToJson } from "./item-session-json.js";
import { DELIVERY_STATUSES } from "./names.js";
import { catSchema, catToJson, reportSchema, scoringSchema, scoringToJson } from "./pending-json.js";
import type { PlannedChild, PlannedPart, TestPlan } from "./plan.js";
import { supportNameSchema, supportsSchema } from "./support-json.js";

/** The kinds of scope of a clock, for the checks. */
const CLOCK_SCOPES: readonly ScopeClock["scope"][] = ["test", "part", "section"];

function itemToJson(item: DeliveredItem): unknown {
  const { variant, submittedAt, expired, marked } = item;
  return {
    session: itemSessionToJson(item.session),
    ...(variant === undefined ? {} : { variant }),
    supports: item.supports,
    ...(submittedAt === undefined ? {} : { submittedAt }),
    ...(expired === undefined ? {} : { expired }),
    ...(marked === undefined ? {} : { marked }),
  };
}

/**
 * Writes a state as JSON text: plain data whose values are `WireValue`s, NULL as `null`, and whose maps are arrays of
 * entries, so that an identifier such as `__proto__` stays data.
 *
 * @remarks
 * File values are references. The text carries the version of the format, which `deserializeState` checks, and the
 * version of the content when the engine named one.
 *
 * @param state - The state.
 * @returns The JSON text.
 * @throws `DataError` when the state is not one.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function serializeState(state: DeliveryState): string {
  checkState(state);
  const { current, contentVersion } = state;
  return JSON.stringify({
    version: state.version,
    ...(contentVersion === undefined ? {} : { contentVersion }),
    status: state.status,
    at: state.at,
    random: state.random,
    plan: state.plan,
    ...(current === undefined ? {} : { current }),
    items: state.items.map(itemToJson),
    outcomes: valuesToJson(state.outcomes),
    context: valuesToJson(state.context),
    clocks: state.clocks,
    supports: [...state.supports],
    needs: state.needs,
    scoring: scoringToJson(state.scoring),
    cat: catToJson(state.cat),
    report: state.report,
  });
}

const sectionSchema = v.object({
  kind: v.literal("section"),
  identifier: v.string(),
  instance: positiveIntegerSchema,
  children: v.array(v.lazy((): Schema<PlannedChild> => childSchema)),
});

const childSchema: Schema<PlannedChild> = v.variant("kind", [
  v.object({ kind: v.literal("item"), key: itemKeySchema }),
  sectionSchema,
]);

const planSchema: Schema<TestPlan> = v.object({
  parts: v.array(
    v.object({
      kind: v.literal("part"),
      identifier: v.string(),
      children: v.array(sectionSchema),
    }) satisfies Schema<PlannedPart>,
  ),
});

const expirySchema = v.picklist(EXPIRIES);

const deliveredItemSchema: Schema<DeliveredItem> = v.object({
  session: itemSessionSchema,
  variant: v.optional(v.string()),
  supports: v.array(supportNameSchema),
  submittedAt: v.optional(finiteSchema),
  expired: v.optional(expirySchema),
  marked: v.optional(v.literal(true)),
});

const clockSchema: Schema<ScopeClock> = v.object({
  scope: v.picklist(CLOCK_SCOPES),
  identifier: v.string(),
  spent: nonNegativeSchema,
  expired: v.optional(expirySchema),
});

const testingTimeSchema: Schema<TestingTime> = v.variant("kind", [
  v.object({ kind: v.literal("time-multiplier"), multiplier: finiteSchema }),
  v.object({ kind: v.literal("fixed-minutes"), minutes: nonNegativeSchema }),
  v.object({ kind: v.literal("unlimited") }),
]);

const needsSchema: Schema<CandidateNeeds> = v.object({
  testingTime: v.optional(testingTimeSchema),
  avoidedHazards: v.array(v.picklist(PNP_HAZARDS)),
  translation: v.optional(v.string()),
  personalNeeds: v.optional(v.string()),
});

// The version comes first, so that a state of another format is refused for its version, whatever else it holds.
const stateSchema: Schema<DeliveryState> = v.object({
  version: v.literal(STATE_VERSION),
  contentVersion: v.optional(v.string()),
  status: v.picklist(DELIVERY_STATUSES),
  at: finiteSchema,
  random: v.pipe(
    v.strictTuple([v.number(), v.number(), v.number(), v.number()]),
    // restoreRandom checks the range of the words.
    transformWith((words) => restoreRandom(words).state()),
  ),
  plan: planSchema,
  current: v.optional(itemKeySchema),
  items: v.array(deliveredItemSchema),
  outcomes: valuesSchema,
  context: valuesSchema,
  clocks: v.array(clockSchema),
  supports: supportsSchema,
  needs: needsSchema,
  scoring: scoringSchema,
  cat: catSchema,
  report: reportSchema,
});

/**
 * Reads a state that {@link serializeState} wrote, checking it deeply: its version, and the type of every field.
 *
 * @remarks
 * A state of a later version of the format is refused. A key that this version does not know is dropped, so that a
 * state read and written again loses the fields of a later minor release. The text comes from the host's own store, and the
 * engine built the state from actions that passed the limits of `readCandidateAction`, so the reader sets no limit of size.
 * Do not pass it a text that a client sent.
 *
 * @param text - The JSON text that `serializeState` wrote.
 * @returns The state.
 * @throws `DataError` when the text is not JSON, is of another version, or is not a state.
 */
export function deserializeState(text: string): DeliveryState {
  checkString(text, "The state");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new DataError("The state must be the JSON text that serializeState writes, found text that is not JSON.", {
      cause: error,
    });
  }
  return parseWith(stateSchema, json, "The state");
}
