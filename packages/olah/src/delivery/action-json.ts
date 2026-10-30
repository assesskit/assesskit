import {
  checkBoolean,
  checkChoice,
  checkOptions,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
  isRecord,
} from "../checks.js";
import { DataError } from "../errors.js";
import { isSupportName } from "../pnp/index.js";
import type { CandidateAction } from "./action.js";
import { CANDIDATE_ACTION_TYPES } from "./candidate-actions.js";
import { readEntries, readValues, valuesToJson } from "./entries-json.js";
import { checkKey, type ItemKey } from "./item-key.js";
import { checkShape } from "./json-checks.js";

/** The limits of {@link parseCandidateAction}, which keep a client from sending an action that is too large to handle. */
export interface ActionLimits {
  /**
   * The size of an action: each string, number, boolean, `null`, array and object counts 1, and each string and property
   * name adds its length in code units. Default: `4194304`.
   */
  readonly maxActionSize: number;
  /** The length of one portable custom interaction state, in code units (E29). Default: `1048576`. */
  readonly maxPciStateLength: number;
}

/** The default limits of {@link parseCandidateAction}. */
export const DEFAULT_ACTION_LIMITS: ActionLimits = { maxActionSize: 4_194_304, maxPciStateLength: 1_048_576 };

/** The types of the actions of the host, which a candidate never sends (E22). */
const HOST_ACTION_TYPES: readonly string[] = ["time", "supply-scores", "cat-response"];

/** The places that `move` names by a word. */
const MOVES = ["next", "previous"] as const;

function readLimits(limits: Partial<ActionLimits>): ActionLimits {
  checkOptions(limits);
  const {
    maxActionSize = DEFAULT_ACTION_LIMITS.maxActionSize,
    maxPciStateLength = DEFAULT_ACTION_LIMITS.maxPciStateLength,
  } = limits;
  checkPositiveInteger(maxActionSize, "The limit maxActionSize");
  checkPositiveInteger(maxPciStateLength, "The limit maxPciStateLength");
  return { maxActionSize, maxPciStateLength };
}

/**
 * Checks that JSON is not larger than the limit. It counts without recursion and stops once the limit is passed, so that
 * the check costs no more than the limit, whatever the input.
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
    throw new DataError(`The action is larger than the limit maxActionSize of ${limit}.`);
  }
}

function readItemRef(json: Readonly<Record<string, unknown>>): ItemKey {
  checkKey(json.item);
  return { ref: json.item.ref, instance: json.item.instance };
}

/**
 * Reads the JSON form of an action of the candidate, as {@link actionToJson} writes it, and checks it: the type, every
 * property of the type and no other, the values as wire values, and the limits. The action has no time: the server stamps
 * it with {@link stamp} (E22), and an action of the host (`time`, `supply-scores`, `cat-response`) or a property `at` is
 * refused.
 *
 * @param json - The parsed JSON.
 * @param limits - Limits that replace those of {@link DEFAULT_ACTION_LIMITS}; a limit left out keeps its default.
 * Default: none.
 * @throws `DataError` when the input is not an action of the candidate, or is larger than a limit.
 */
export function parseCandidateAction(json: unknown, limits: Partial<ActionLimits> = {}): CandidateAction {
  const { maxActionSize, maxPciStateLength } = readLimits(limits);
  checkSize(json, maxActionSize);
  checkRecord(json, "The action must be an object with a type");
  if (typeof json.type === "string" && HOST_ACTION_TYPES.includes(json.type)) {
    throw new DataError(
      `The type ${describe(json.type)} is an action of the host, and a candidate does not send it; the type of an action of a candidate is ${CANDIDATE_ACTION_TYPES.map((type) => JSON.stringify(type)).join(", ")}.`,
    );
  }
  checkChoice(json.type, "The type of the action", CANDIDATE_ACTION_TYPES);
  switch (json.type) {
    case "set-responses": {
      checkShape(json, "A set-responses action", ["type", "item", "responses"], ["pciStates"]);
      const pciStates =
        json.pciStates === undefined
          ? undefined
          : readEntries(json.pciStates, "The pciStates of set-responses", (state, identifier) => {
              checkString(state, `The PCI state of ${describe(identifier)}`);
              if (state.length > maxPciStateLength) {
                throw new DataError(
                  `The PCI state of ${describe(identifier)} has ${state.length} code units, more than the limit maxPciStateLength of ${maxPciStateLength}.`,
                );
              }
              return state;
            });
      return {
        type: json.type,
        item: readItemRef(json),
        responses: readValues(json.responses, "The responses of set-responses"),
        ...(pciStates === undefined ? {} : { pciStates }),
      };
    }
    case "submit":
    case "skip":
    case "next-attempt":
    case "review":
    case "solution":
      checkShape(json, `A ${json.type} action`, ["type", "item"]);
      return { type: json.type, item: readItemRef(json) };
    case "end-attempt":
      checkShape(json, "An end-attempt action", ["type", "item", "interaction"]);
      checkString(json.interaction, "The interaction of end-attempt");
      return { type: json.type, item: readItemRef(json), interaction: json.interaction };
    case "comment":
      checkShape(json, "A comment action", ["type", "item", "text"]);
      checkString(json.text, "The text of comment");
      return { type: json.type, item: readItemRef(json), text: json.text };
    case "move": {
      checkShape(json, "A move action", ["type", "to"]);
      if (typeof json.to !== "string") {
        checkKey(json.to);
        return { type: json.type, to: { ref: json.to.ref, instance: json.to.instance } };
      }
      const word = MOVES.find((move) => move === json.to);
      if (word === undefined) {
        throw new DataError(
          `The place of move must be "next", "previous" or an item instance, found ${describe(json.to)}.`,
        );
      }
      return { type: json.type, to: word };
    }
    case "support": {
      checkShape(json, "A support action", ["type", "name", "active"]);
      if (!isSupportName(json.name)) {
        throw new DataError(
          `The name of support must be the name of a support of a PNP, found ${describe(json.name)}.`,
        );
      }
      checkBoolean(json.active, "The active of support");
      return { type: json.type, name: json.name, active: json.active };
    }
    case "end-part":
    case "end-test":
    case "suspend":
    case "resume":
      checkShape(json, `A ${json.type} action`, ["type"]);
      return { type: json.type };
  }
}

/** The limits that let {@link actionToJson} check the form it writes without refusing a large action. */
const UNLIMITED: ActionLimits = {
  maxActionSize: Number.MAX_SAFE_INTEGER,
  maxPciStateLength: Number.MAX_SAFE_INTEGER,
};

/**
 * Writes an action of the candidate as plain data that `JSON.stringify` keeps whole (E30): values are wire values, NULL is
 * `null`, and maps are arrays of entries. Only the properties of the action's type are written, so a time `at` is not.
 * The result is read back by {@link parseCandidateAction} before it is returned.
 *
 * @throws `DataError` when the action is not an action of the candidate.
 */
export function actionToJson(action: CandidateAction): unknown {
  checkRecord(action, "The action must be an object with a type");
  checkChoice(action.type, "The type of the action", CANDIDATE_ACTION_TYPES);
  let json: Readonly<Record<string, unknown>>;
  switch (action.type) {
    case "set-responses":
      if (!(action.responses instanceof Map)) {
        throw new DataError(
          `The responses of set-responses must be a Map from response identifier to value, found ${describe(action.responses)}.`,
        );
      }
      if (action.pciStates !== undefined && !(action.pciStates instanceof Map)) {
        throw new DataError(
          `The pciStates of set-responses must be a Map from response identifier to state, found ${describe(action.pciStates)}.`,
        );
      }
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
    case "move":
      json = { type: action.type, to: typeof action.to === "string" ? action.to : itemKeyJson(action.to) };
      break;
    case "support":
      json = { type: action.type, name: action.name, active: action.active };
      break;
    case "end-part":
    case "end-test":
    case "suspend":
    case "resume":
      json = { type: action.type };
      break;
  }
  parseCandidateAction(json, UNLIMITED);
  return json;
}

/** Returns an item instance for JSON. */
function itemKeyJson(key: unknown): ItemKey {
  checkKey(key);
  return { ref: key.ref, instance: key.instance };
}
