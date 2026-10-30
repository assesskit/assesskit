import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkFinite,
  checkNonNegativeInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import type { ItemVariables } from "../processing/index.js";
import type { Value } from "../values/index.js";
import { readEntries, readValues, type ValueJson, valuesToJson } from "./entries-json.js";
import { checkKey } from "./item-key.js";
import type { ItemSession } from "./item-session.js";
import { ITEM_SESSION_STATUSES } from "./names.js";

/** The kinds of variables of a session. */
type VariableKind = keyof ItemVariables;

/** The JSON form of an item session: plain data, with maps as entry arrays and values as wire values. */
export interface ItemSessionJson {
  readonly key: { readonly ref: string; readonly instance: number };
  readonly status: ItemSession["status"];
  readonly attempting: boolean;
  readonly countedAttempts: number;
  readonly variables: Readonly<Record<VariableKind, readonly (readonly [string, ValueJson])[]>>;
  readonly drafts: readonly (readonly [string, ValueJson])[];
  readonly processingFailed: boolean;
  readonly choiceOrders: readonly (readonly [string, readonly (readonly string[])[]])[];
  readonly pciStates: readonly (readonly [string, string])[];
  readonly comment?: string;
  readonly spent: number;
  readonly since: number | null;
  readonly updatedAt: number;
}

/**
 * Writes an item session as plain data that `JSON.stringify` keeps whole: maps as arrays of entries, values as
 * `WireValue`s and NULL as `null` (E2, E30).
 */
export function itemSessionToJson(session: ItemSession): ItemSessionJson {
  const { variables } = session;
  return {
    key: { ref: session.key.ref, instance: session.key.instance },
    status: session.status,
    attempting: session.attempting,
    countedAttempts: session.countedAttempts,
    variables: {
      contexts: valuesToJson(variables.contexts),
      responses: valuesToJson(variables.responses),
      outcomes: valuesToJson(variables.outcomes),
      templates: valuesToJson(variables.templates),
      correctResponses: valuesToJson(variables.correctResponses),
      defaults: valuesToJson(variables.defaults),
    },
    drafts: valuesToJson(session.drafts),
    processingFailed: session.processingFailed,
    choiceOrders: [...session.choiceOrders],
    pciStates: [...session.pciStates],
    ...(session.comment === undefined ? {} : { comment: session.comment }),
    spent: session.spent,
    since: session.since,
    updatedAt: session.updatedAt,
  };
}

function readOrders(json: unknown, identifier: string): readonly (readonly string[])[] {
  checkArray(json, `The choice orders of ${describe(identifier)} must be an array of lists`);
  return json.map((set) => {
    checkArray(set, `A list of the choice orders of ${describe(identifier)} must be an array`);
    return set.map((choice) => {
      checkString(choice, `A choice of the choice orders of ${describe(identifier)}`);
      return choice;
    });
  });
}

/**
 * Reads an item session that {@link itemSessionToJson} wrote, as `JSON.parse` returns it.
 *
 * @throws `DataError` when the data is not such a session.
 */
export function itemSessionFromJson(json: unknown): ItemSession {
  checkRecord(json, "An item session must be an object");
  const { key, status, attempting, countedAttempts, variables, comment, spent, since, updatedAt } = json;
  checkKey(key);
  checkChoice(status, "The status of the item session", ITEM_SESSION_STATUSES);
  checkBoolean(attempting, "The attempting of the item session");
  checkNonNegativeInteger(countedAttempts, "The countedAttempts of the item session");
  checkRecord(variables, "The variables of the item session must be an object");
  const read = (kind: VariableKind): Map<string, Value | null> =>
    readValues(variables[kind], `The ${kind} of the item session`);
  const itemVariables: ItemVariables = {
    contexts: read("contexts"),
    responses: read("responses"),
    outcomes: read("outcomes"),
    templates: read("templates"),
    correctResponses: read("correctResponses"),
    defaults: read("defaults"),
  };
  checkBoolean(json.processingFailed, "The processingFailed of the item session");
  if (comment !== undefined) checkString(comment, "The comment of the item session");
  checkFinite(spent, "The spent of the item session");
  if (since !== null) checkFinite(since, "The since of the item session");
  checkFinite(updatedAt, "The updatedAt of the item session");
  return {
    key: { ref: key.ref, instance: key.instance },
    status,
    attempting,
    countedAttempts,
    variables: itemVariables,
    drafts: readValues(json.drafts, "The drafts of the item session"),
    processingFailed: json.processingFailed,
    choiceOrders: readEntries(json.choiceOrders, "The choiceOrders of the item session", readOrders),
    pciStates: readEntries(json.pciStates, "The pciStates of the item session", (state, identifier) => {
      checkString(state, `The PCI state of ${describe(identifier)}`);
      return state;
    }),
    ...(comment === undefined ? {} : { comment }),
    spent,
    since,
    updatedAt,
  };
}
