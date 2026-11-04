import * as v from "valibot";
import {
  checkChoice,
  checkOptions,
  checkPositiveInteger,
  checkRecord,
  describe,
  isRecord,
  parseWith,
  type Schema,
} from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import type { CandidateAction } from "./action.js";
import { CANDIDATE_ACTION_TYPES, checkResponseMaps } from "./candidate-actions.js";
import { entriesSchema, valuesSchema, valuesToJson } from "./entries-json.js";
import { checkKey, type ItemKey, itemKeySchema } from "./item-key.js";
import { supportNameSchema, supportSettingSchema } from "./support-json.js";

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

/** The types of the actions of the host, which a candidate never sends. */
const HOST_ACTION_TYPES: readonly string[] = ["time", "supply-scores", "cat-response"];

/** The places that `move` names by a word. */
const MOVES = ["next", "previous"] as const;

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

/**
 * Checks that JSON is not larger than the limit. It counts without recursion and stops once the limit is passed, so
 * that the check costs no more than the limit, whatever the input.
 */
function checkSize(json: unknown, limit: number): void {
  const pending: unknown[] = [json];
  let size = 0;
  while (pending.length > 0 && size <= limit) {
    const value = pending.pop();
    size += 1;
    if (typeof value === "string") size += value.length;
    else if (Array.isArray(value)) for (const member of value) pending.push(member);
    else if (isRecord(value)) {
      for (const [name, member] of Object.entries(value)) {
        size += name.length;
        pending.push(member);
      }
    }
  }
  if (size > limit) {
    throw new SecurityError(`The action is larger than the limit maxActionSize of ${limit}.`, "maxActionSize", limit);
  }
}

const itemSchema = { item: itemKeySchema };

const actionSchema: Schema<CandidateAction> = v.variant("type", [
  v.strictObject({
    type: v.literal("set-responses"),
    ...itemSchema,
    responses: valuesSchema,
    pciStates: v.optional(entriesSchema(v.string())),
  }),
  v.strictObject({ type: v.picklist(["submit", "skip", "next-attempt", "review", "solution"]), ...itemSchema }),
  v.strictObject({ type: v.literal("end-attempt"), ...itemSchema, interaction: v.string() }),
  v.strictObject({ type: v.literal("comment"), ...itemSchema, text: v.string() }),
  v.strictObject({ type: v.literal("mark"), ...itemSchema, marked: v.boolean() }),
  v.strictObject({
    type: v.literal("move"),
    to: v.union(
      [v.picklist(MOVES), itemKeySchema],
      'The place of move must be "next", "previous" or an item instance.',
    ),
  }),
  v.strictObject({ type: v.literal("support"), name: supportNameSchema, active: v.boolean() }),
  v.strictObject({ type: v.literal("support-settings"), settings: supportSettingSchema }),
  v.strictObject({ type: v.picklist(["end-part", "end-test", "suspend", "resume"]) }),
]);

/** Refuses an action of the host, which a candidate never sends. */
function refuseHostAction(json: unknown): void {
  if (isRecord(json) && typeof json.type === "string" && HOST_ACTION_TYPES.includes(json.type)) {
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
 * settings are read. It walks without recursion a value that {@link checkSize} has bounded.
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
 * The action has no time: the server stamps it with {@link stamp}, and an action of the host (`time`, `supply-scores`,
 * `cat-response`) or a property `at` is refused.
 *
 * @param json - The parsed JSON.
 * @param options - See {@link ReadCandidateActionOptions}.
 * @returns The action of the candidate, without a time.
 * @throws `DataError` when the input is not an action of the candidate, or an option has the wrong type.
 * @throws `SecurityError` when the action is larger than `maxActionSize`, a PCI state is longer than `maxPciStateLength`, or
 * a list in the settings of `support-settings` is longer than `maxSettingListLength`.
 */
export function readCandidateAction(json: unknown, options: ReadCandidateActionOptions = {}): CandidateAction {
  checkOptions(options);
  const { limits = {} } = options;
  const { maxActionSize, maxPciStateLength, maxSettingListLength } = readLimits(limits);
  checkSize(json, maxActionSize);
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
 * Writes an action of the candidate as plain data that `JSON.stringify` keeps whole: values are wire values, NULL is
 * `null`, and maps are arrays of entries.
 *
 * @remarks
 * Only the properties of the action's type are written, so a time `at` is not. The result is read back by
 * {@link readCandidateAction} before it is returned.
 *
 * @param action - The action.
 * @returns The plain data of the action.
 * @throws `DataError` when the action is not an action of the candidate.
 */
export function writeCandidateAction(action: CandidateAction): unknown {
  checkRecord(action, "The action must be an object with a type");
  checkChoice(action.type, "The type of the action", CANDIDATE_ACTION_TYPES);
  let json: Readonly<Record<string, unknown>>;
  switch (action.type) {
    case "set-responses":
      checkResponseMaps(action);
      json = {
        type: action.type,
        item: itemKeyJson(action.item),
        responses: valuesToJson(action.responses),
        ...(action.pciStates === undefined ? {} : { pciStates: [...action.pciStates] }),
      };
      break;
    case "submit":
    case "skip":
    case "next-attempt":
    case "review":
    case "solution":
      json = { type: action.type, item: itemKeyJson(action.item) };
      break;
    case "end-attempt":
      json = { type: action.type, item: itemKeyJson(action.item), interaction: action.interaction };
      break;
    case "comment":
      json = { type: action.type, item: itemKeyJson(action.item), text: action.text };
      break;
    case "mark":
      json = { type: action.type, item: itemKeyJson(action.item), marked: action.marked };
      break;
    case "move":
      json = { type: action.type, to: typeof action.to === "string" ? action.to : itemKeyJson(action.to) };
      break;
    case "support":
      json = { type: action.type, name: action.name, active: action.active };
      break;
    case "support-settings":
      json = { type: action.type, settings: action.settings };
      break;
    case "end-part":
    case "end-test":
    case "suspend":
    case "resume":
      json = { type: action.type };
      break;
  }
  readCandidateAction(json, { limits: UNLIMITED });
  return json;
}

/** Returns an item instance for JSON. */
function itemKeyJson(key: unknown): ItemKey {
  checkKey(key);
  return { ref: key.ref, instance: key.instance };
}
