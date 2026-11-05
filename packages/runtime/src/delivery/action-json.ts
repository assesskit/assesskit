import * as v from "valibot";
import {
  checkChoice,
  checkJsonInput,
  checkPositiveInteger,
  checkRecord,
  describe,
  isRecord,
  parseWith,
  type Schema,
} from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError, SecurityError } from "../errors.js";
import { CANDIDATE_ACTION_TYPES, type CandidateAction, candidateActionSchemas, HOST_ACTION_TYPES } from "./action.js";
import { entriesSchema, valuesSchema, valuesToJson } from "./entries-json.js";
import { checkKey, type ItemKey, itemKeySchema } from "./item-key.js";

/** The limits of {@link readCandidateAction}, which keep a client from sending an action that is too large to handle. */
export interface ActionLimits {
  /**
   * The size of an action: each string, number, boolean, `null`, array and object counts 1, and each string and
   * property name adds its length in code units.
   *
   * @defaultValue `4194304`
   */
  readonly maxActionSize: number;
  /**
   * The length of one portable custom interaction state, in code units.
   *
   * @defaultValue `1048576`
   */
  readonly maxPciStateLength: number;
  /**
   * The entries of one list in the settings of a `support-settings` action, such as the font names of `text-appearance`:
   * reading the settings builds an element of a profile for each entry, which takes far more memory than the entry.
   *
   * @defaultValue `256`
   */
  readonly maxSettingListLength: number;
}

/** The options of {@link readCandidateAction}. */
export interface ReadCandidateActionOptions {
  /**
   * Limits that replace those of {@link DEFAULT_ACTION_LIMITS}, field by field.
   *
   * @defaultValue {@link DEFAULT_ACTION_LIMITS}
   */
  readonly limits?: Partial<ActionLimits>;
}

/** The default limits of {@link readCandidateAction}. */
export const DEFAULT_ACTION_LIMITS: ActionLimits = {
  maxActionSize: 4_194_304,
  maxPciStateLength: 1_048_576,
  maxSettingListLength: 256,
};

function readLimits(limits: Partial<ActionLimits>): ActionLimits {
  checkRecord(limits, "The option limits must be an object");
  const {
    maxActionSize = DEFAULT_ACTION_LIMITS.maxActionSize,
    maxPciStateLength = DEFAULT_ACTION_LIMITS.maxPciStateLength,
    maxSettingListLength = DEFAULT_ACTION_LIMITS.maxSettingListLength,
  } = limits;
  checkPositiveInteger(maxActionSize, "The limit maxActionSize");
  checkPositiveInteger(maxPciStateLength, "The limit maxPciStateLength");
  checkPositiveInteger(maxSettingListLength, "The limit maxSettingListLength");
  return { maxActionSize, maxPciStateLength, maxSettingListLength };
}

const actionSchema: Schema<CandidateAction> = v.variant(
  "type",
  candidateActionSchemas({
    object: v.strictObject,
    item: itemKeySchema,
    responses: valuesSchema,
    pciStates: entriesSchema(v.string()),
  }),
);

/** Refuses an action of the host, which a candidate never sends. */
function refuseHostAction(json: unknown): void {
  if (isRecord(json) && HOST_ACTION_TYPES.some((type) => type === json.type)) {
    throw new DataError(
      `The type ${describe(json.type)} is an action of the host, and a candidate does not send it; the type of an action of a candidate is ${CANDIDATE_ACTION_TYPES.map((type) => JSON.stringify(type)).join(", ")}.`,
    );
  }
}

/** Returns the members of a JSON array or object, and none of another value. */
const membersOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [];

/**
 * Checks every list in the settings of a `support-settings` action against the limit, nested lists included, before the
 * settings are read. It walks without recursion a value that {@link checkJsonInput} has bounded.
 */
function checkSettingLists(json: unknown, limit: number): void {
  if (!isRecord(json) || json.type !== "support-settings") return;
  const pending: unknown[] = [json.settings];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value) && value.length > limit) {
      throw new SecurityError(
        `A list in the settings of support-settings has ${value.length} entries, more than the limit maxSettingListLength of ${limit}.`,
        "maxSettingListLength",
        limit,
      );
    }
    for (const member of membersOf(value)) pending.push(member);
  }
}

/** Checks the length of every PCI state against the limit, which is the caller's and not the form's. */
function checkPciStates(action: CandidateAction, limit: number): void {
  if (action.type !== "set-responses" || action.pciStates === undefined) return;
  for (const [identifier, state] of action.pciStates) {
    if (state.length > limit) {
      throw new SecurityError(
        `The PCI state of ${describe(identifier)} has ${state.length} code units, more than the limit maxPciStateLength of ${limit}.`,
        "maxPciStateLength",
        limit,
      );
    }
  }
}

/**
 * Reads the JSON form of an action of the candidate, as {@link writeCandidateAction} writes it, and checks it: the type, every
 * property of the type and no other, the values as wire values, and the limits.
 *
 * @remarks
 * The action has no time: the server stamps it with `stamp` of `delivery`, and an action of the host (`time`, `supply-scores`,
 * `cat-response`) or a property `at` is refused.
 *
 * @param json - The parsed JSON.
 * @param options - See {@link ReadCandidateActionOptions}.
 * @returns The action of the candidate, without a time.
 * @throws `DataError` when the input is not an action of the candidate, a property at any depth is named `__proto__`,
 * `prototype` or `constructor`, or an option has the wrong type.
 * @throws `SecurityError` when the action is larger than `maxActionSize`, a PCI state is longer than `maxPciStateLength`, or
 * a list in the settings of `support-settings` is longer than `maxSettingListLength`.
 */
export function readCandidateAction(json: unknown, options: ReadCandidateActionOptions = {}): CandidateAction {
  checkOptions(options);
  const { limits = {} } = options;
  const { maxActionSize, maxPciStateLength, maxSettingListLength } = readLimits(limits);
  checkJsonInput(json, "The action", maxActionSize, "maxActionSize");
  refuseHostAction(json);
  checkSettingLists(json, maxSettingListLength);
  const action = parseWith(actionSchema, json, "The action");
  checkPciStates(action, maxPciStateLength);
  return action;
}

/** The limits that let {@link writeCandidateAction} check the form it writes without refusing a large action. */
const UNLIMITED: ActionLimits = {
  maxActionSize: Number.MAX_SAFE_INTEGER,
  maxPciStateLength: Number.MAX_SAFE_INTEGER,
  maxSettingListLength: Number.MAX_SAFE_INTEGER,
};

/**
 * Checks the maps of a `set-responses` action: the responses by response identifier, and the states of portable custom
 * interactions when it has them.
 *
 * @throws `DataError` when one is not a `Map`.
 */
function checkResponseMaps({ responses, pciStates }: Readonly<Record<string, unknown>>): void {
  if (!(responses instanceof Map)) {
    throw new DataError(
      `The responses of set-responses must be a Map from response identifier to value, found ${describe(responses)}.`,
    );
  }
  if (pciStates !== undefined && !(pciStates instanceof Map)) {
    throw new DataError(
      `The pciStates of set-responses must be a Map from response identifier to state, found ${describe(pciStates)}.`,
    );
  }
}

/**
 * Writes an action of the candidate as plain data that `JSON.stringify` keeps whole: values are wire values, NULL is
 * `null`, and maps are arrays of entries.
 *
 * @remarks
 * A time `at` is not written. The result is read back by {@link readCandidateAction} before it is returned, so a property
 * that the action's type does not have is refused.
 *
 * @param action - The action.
 * @returns The plain data of the action.
 * @throws `DataError` when the action is not an action of the candidate.
 */
export function writeCandidateAction(action: CandidateAction): unknown {
  checkRecord(action, "The action must be an object with a type");
  checkChoice(action.type, "The type of the action", CANDIDATE_ACTION_TYPES);
  const { at: _at, responses, pciStates, ...fields }: Readonly<Record<string, unknown>> = action;
  if (action.type === "set-responses") checkResponseMaps(action);
  const json = {
    ...fields,
    ...("item" in fields ? { item: itemKeyJson(fields.item) } : {}),
    ...(typeof fields.to === "object" ? { to: itemKeyJson(fields.to) } : {}),
    ...(responses instanceof Map
      ? { responses: valuesToJson(responses) }
      : responses === undefined
        ? {}
        : { responses }),
    ...(pciStates instanceof Map ? { pciStates: [...pciStates] } : pciStates === undefined ? {} : { pciStates }),
  };
  readCandidateAction(json, { limits: UNLIMITED });
  return json;
}

/** Returns an item instance for JSON. */
function itemKeyJson(key: unknown): ItemKey {
  checkKey(key);
  return { ref: key.ref, instance: key.instance };
}
