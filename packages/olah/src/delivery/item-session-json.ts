import * as v from "valibot";
import { finiteSchema, nonNegativeIntegerSchema, parseWith, type Schema } from "../checks.js";
import type { ItemVariables } from "../processing/index.js";
import { entriesSchema, type ValueJson, valuesSchema, valuesToJson } from "./entries-json.js";
import { itemKeySchema } from "./item-key.js";
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

/** The schema of an item session that {@link itemSessionToJson} wrote. */
export const itemSessionSchema: Schema<ItemSession> = v.object({
  key: itemKeySchema,
  status: v.picklist(ITEM_SESSION_STATUSES),
  attempting: v.boolean(),
  countedAttempts: nonNegativeIntegerSchema,
  variables: v.object({
    contexts: valuesSchema,
    responses: valuesSchema,
    outcomes: valuesSchema,
    templates: valuesSchema,
    correctResponses: valuesSchema,
    defaults: valuesSchema,
  }) satisfies Schema<ItemVariables>,
  drafts: valuesSchema,
  processingFailed: v.boolean(),
  choiceOrders: entriesSchema(v.array(v.array(v.string()))),
  pciStates: entriesSchema(v.string()),
  comment: v.optional(v.string()),
  spent: finiteSchema,
  since: v.nullable(finiteSchema),
  updatedAt: finiteSchema,
});

/**
 * Reads an item session that {@link itemSessionToJson} wrote, as `JSON.parse` returns it.
 *
 * @throws `DataError` when the data is not such a session.
 */
export function itemSessionFromJson(json: unknown): ItemSession {
  return parseWith(itemSessionSchema, json, "The item session");
}
