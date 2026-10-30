import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkFinite,
  checkNonNegative,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { DataError } from "../errors.js";
import { isSupportName, PNP_HAZARDS, type SupportName, type SupportState, type TestingTime } from "../pnp/index.js";
import { type RandomState, restoreRandom } from "../random.js";
import {
  type CandidateNeeds,
  checkState,
  DELIVERY_STATUSES,
  type DeliveredItem,
  type DeliveryState,
  EXPIRIES,
  type ScopeClock,
  type SessionSupport,
  STATE_VERSION,
} from "./delivery-state.js";
import { itemSessionFromJson, itemSessionToJson, readEntries, readValues, valuesToJson } from "./item-session-json.js";
import { checkKey, type ItemKey, type PlannedChild, type PlannedPart, type TestPlan } from "./plan.js";

/** The states of a support, for the checks. */
const SUPPORT_STATES: readonly SupportState[] = ["prohibited", "active", "option", "assigned"];

/** The kinds of scope of a clock, for the checks. */
const CLOCK_SCOPES: readonly ScopeClock["scope"][] = ["test", "part", "section"];

/** The kinds of extra testing time, for the checks. */
const TESTING_TIMES: readonly TestingTime["kind"][] = ["time-multiplier", "fixed-minutes", "unlimited"];

function itemToJson(item: DeliveredItem): unknown {
  const { variant, submittedAt, expired } = item;
  return {
    session: itemSessionToJson(item.session),
    ...(variant === undefined ? {} : { variant }),
    supports: item.supports,
    ...(submittedAt === undefined ? {} : { submittedAt }),
    ...(expired === undefined ? {} : { expired }),
  };
}

/**
 * Writes a state as JSON text (E2): plain data whose values are `WireValue`s, NULL as `null`, and whose maps are arrays
 * of entries, so that an identifier such as `__proto__` stays data (E30). File values are references (D7). The text
 * carries the version of the format, which `deserializeState` checks.
 *
 * @throws `DataError` when the state is not one.
 */
export function serializeState(state: DeliveryState): string {
  checkState(state);
  const { current } = state;
  return JSON.stringify({
    version: state.version,
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
  });
}

function readKey(json: unknown): ItemKey {
  checkKey(json);
  return { ref: json.ref, instance: json.instance };
}

function readChild(json: unknown): PlannedChild {
  checkRecord(json, "A child of a section of the plan must be an object");
  if (json.kind === "item") return { kind: "item", key: readKey(json.key) };
  if (json.kind !== "section") {
    throw new DataError(
      `A child of a section of the plan must have the kind "item" or "section", found ${describe(json.kind)}.`,
    );
  }
  checkString(json.identifier, "The identifier of a section of the plan");
  checkPositiveInteger(json.instance, "The instance of a section of the plan");
  checkArray(json.children, "The children of a section of the plan must be an array");
  return {
    kind: "section",
    identifier: json.identifier,
    instance: json.instance,
    children: json.children.map(readChild),
  };
}

function readPart(json: unknown): PlannedPart {
  checkRecord(json, "A test part of the plan must be an object");
  if (json.kind !== "part")
    throw new DataError(`A test part of the plan must have the kind "part", found ${describe(json.kind)}.`);
  checkString(json.identifier, "The identifier of a test part of the plan");
  checkArray(json.children, "The sections of a test part of the plan must be an array");
  const children = json.children.map((child) => {
    const section = readChild(child);
    if (section.kind !== "section") throw new DataError("A test part of the plan must hold sections only.");
    return section;
  });
  return { kind: "part", identifier: json.identifier, children };
}

function readPlan(json: unknown): TestPlan {
  checkRecord(json, "The plan of the state must be an object");
  checkArray(json.parts, "The parts of the plan must be an array");
  return { parts: json.parts.map(readPart) };
}

function readExpiry(json: unknown): { readonly expired?: ScopeClock["expired"] } {
  if (json === undefined) return {};
  checkChoice(json, "An expiry", EXPIRIES);
  return { expired: json };
}

function readSupportNames(json: unknown, label: string): SupportName[] {
  checkArray(json, `${label} must be an array of support names`);
  return json.map((name) => {
    if (!isSupportName(name)) throw new DataError(`${label} must be support names, found ${describe(name)}.`);
    return name;
  });
}

function readItem(json: unknown): DeliveredItem {
  checkRecord(json, "An item of the state must be an object");
  const { variant, submittedAt } = json;
  if (variant !== undefined) checkString(variant, "The variant of an item of the state");
  if (submittedAt !== undefined) checkFinite(submittedAt, "The submittedAt of an item of the state");
  return {
    session: itemSessionFromJson(json.session),
    ...(variant === undefined ? {} : { variant }),
    supports: readSupportNames(json.supports, "The supports of an item of the state"),
    ...(submittedAt === undefined ? {} : { submittedAt }),
    ...readExpiry(json.expired),
  };
}

function readClock(json: unknown): ScopeClock {
  checkRecord(json, "A clock of the state must be an object");
  checkChoice(json.scope, "The scope of a clock of the state", CLOCK_SCOPES);
  checkString(json.identifier, "The identifier of a clock of the state");
  checkNonNegative(json.spent, "The spent of a clock of the state");
  return { scope: json.scope, identifier: json.identifier, spent: json.spent, ...readExpiry(json.expired) };
}

function readSupport(json: unknown, name: string): SessionSupport {
  checkRecord(json, `The support ${describe(name)} of the state must be an object`);
  checkChoice(json.state, `The state of the support ${describe(name)}`, SUPPORT_STATES);
  checkBoolean(json.active, `The active of the support ${describe(name)}`);
  return { state: json.state, active: json.active };
}

function readSupports(json: unknown): Map<SupportName, SessionSupport> {
  const supports = new Map<SupportName, SessionSupport>();
  for (const [name, support] of readEntries(json, "The supports of the state", readSupport)) {
    if (!isSupportName(name))
      throw new DataError(`A support of the state must have a support name, found ${describe(name)}.`);
    supports.set(name, support);
  }
  return supports;
}

function readTestingTime(json: unknown): TestingTime {
  checkRecord(json, "The testing time of the state must be an object");
  checkChoice(json.kind, "The kind of the testing time of the state", TESTING_TIMES);
  switch (json.kind) {
    case "time-multiplier":
      checkFinite(json.multiplier, "The multiplier of the testing time of the state");
      return { kind: json.kind, multiplier: json.multiplier };
    case "fixed-minutes":
      checkNonNegative(json.minutes, "The minutes of the testing time of the state");
      return { kind: json.kind, minutes: json.minutes };
    case "unlimited":
      return { kind: json.kind };
  }
}

function readNeeds(json: unknown): CandidateNeeds {
  checkRecord(json, "The needs of the state must be an object");
  const { testingTime, translation } = json;
  checkArray(json.avoidedHazards, "The avoided hazards of the state must be an array");
  const avoidedHazards = json.avoidedHazards.map((term) => {
    checkChoice(term, "An avoided hazard of the state", PNP_HAZARDS);
    return term;
  });
  if (translation !== undefined) checkString(translation, "The translation of the state");
  return {
    ...(testingTime === undefined ? {} : { testingTime: readTestingTime(testingTime) }),
    avoidedHazards,
    ...(translation === undefined ? {} : { translation }),
  };
}

/**
 * Reads a state that {@link serializeState} wrote, checking it deeply: its version, and the type of every field. A state
 * of another version of the format is refused, as olah reads only its own.
 *
 * @throws `DataError` when the text is not JSON, is of another version, or is not a state.
 */
export function deserializeState(text: string): DeliveryState {
  checkString(text, "The state");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DataError("The state must be the JSON text that serializeState writes, found text that is not JSON.");
  }
  checkRecord(json, "The state must be a JSON object");
  if (json.version !== STATE_VERSION) {
    throw new DataError(
      `The state has the format version ${describe(json.version)}, and this version of olah reads version ${STATE_VERSION}.`,
    );
  }
  const { status, at, current } = json;
  checkChoice(status, "The status of the state", DELIVERY_STATUSES);
  checkFinite(at, "The at of the state");
  checkArray(json.random, "The random of the state must be an array of four integers");
  checkArray(json.items, "The items of the state must be an array");
  checkArray(json.clocks, "The clocks of the state must be an array");
  return {
    version: STATE_VERSION,
    status,
    at,
    // restoreRandom checks the words it is given.
    random: restoreRandom(json.random as RandomState).state(),
    plan: readPlan(json.plan),
    ...(current === undefined ? {} : { current: readKey(current) }),
    items: json.items.map(readItem),
    outcomes: readValues(json.outcomes, "The outcomes of the state"),
    context: readValues(json.context, "The context of the state"),
    clocks: json.clocks.map(readClock),
    supports: readSupports(json.supports),
    needs: readNeeds(json.needs),
  };
}
