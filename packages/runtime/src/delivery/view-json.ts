import * as v from "valibot";
import type { BodyNode, Catalog, CompanionMaterialsInfo } from "../asi/index.js";
import {
  checkArray,
  checkRecord,
  describe,
  nonNegativeIntegerSchema,
  parseWith,
  plainSchema,
  type Schema,
  transformWith,
} from "../checks.js";
import { nonNegativeSchema } from "../checks-internal.js";
import { DataError } from "../errors.js";
import type { InteractionDescriptor } from "../interactions/index.js";
import { checkDescriptor } from "../interactions/internal.js";
import { PNP_HAZARDS } from "../pnp/index.js";
import type { Value } from "../values/index.js";
import { CANDIDATE_ACTION_TYPES } from "./action.js";
import type {
  CandidateItem,
  CandidateView,
  HazardView,
  LtiView,
  NavigationEntry,
  PartView,
  PciView,
  StimulusView,
  TimerView,
  VariantView,
} from "./candidate-view.js";
import { entriesSchema, valuesSchema, valuesToJson } from "./entries-json.js";
import { checkKey, type ItemKey, itemKeySchema } from "./item-key.js";
import { nodeSchema, nodesSchema } from "./json-checks.js";
import { DELIVERY_STATUSES, ITEM_SESSION_STATUSES } from "./session-statuses.js";
import { supportViewSchema } from "./support-json.js";

const SCOPES: readonly TimerView["scope"][] = ["item", "section", "part", "test"];
const NAVIGATION_MODES: readonly PartView["navigationMode"][] = ["linear", "nonlinear"];
const SUBMISSION_MODES: readonly PartView["submissionMode"][] = ["individual", "simultaneous"];

const optionalString = v.optional(v.string());

const navigationEntrySchema: Schema<NavigationEntry> = v.variant("kind", [
  v.strictObject({
    kind: v.literal("section"),
    identifier: v.string(),
    title: v.string(),
    depth: nonNegativeIntegerSchema,
  }),
  v.strictObject({
    kind: v.literal("item"),
    key: itemKeySchema,
    title: v.string(),
    depth: nonNegativeIntegerSchema,
    status: v.picklist(ITEM_SESSION_STATUSES),
    current: v.boolean(),
    marked: v.boolean(),
    reachable: v.boolean(),
  }),
]);

const timerSchema: Schema<TimerView> = v.strictObject({
  scope: v.picklist(SCOPES),
  identifier: v.string(),
  remaining: v.optional(nonNegativeSchema),
  minimumRemaining: v.optional(nonNegativeSchema),
  late: v.boolean(),
});

const stimulusSchema: Schema<StimulusView> = v.strictObject({
  identifier: v.string(),
  body: nodesSchema<BodyNode>(),
});

const hazardSchema: Schema<HazardView> = v.strictObject({ hazard: v.picklist(PNP_HAZARDS), avoided: v.boolean() });

const pciSchema: Schema<PciView> = v.strictObject({
  templateValues: valuesSchema,
  contextValues: valuesSchema,
  state: optionalString,
});

const ltiSchema: Schema<LtiView> = v.strictObject({
  title: v.string(),
  description: optionalString,
  launchUrl: optionalString,
  secureLaunchUrl: optionalString,
  custom: entriesSchema(v.string()),
});

const descriptorSchema: Schema<InteractionDescriptor> = v.pipe(
  plainSchema,
  transformWith((descriptor: unknown): InteractionDescriptor => {
    checkDescriptor(descriptor);
    return descriptor;
  }),
);

const variantSchema: Schema<VariantView> = v.strictObject({ resource: v.string(), language: optionalString });

const itemSchema: Schema<CandidateItem> = v.strictObject({
  key: itemKeySchema,
  title: v.string(),
  label: optionalString,
  language: optionalString,
  timeDependent: v.boolean(),
  status: v.picklist(ITEM_SESSION_STATUSES),
  numAttempts: nonNegativeIntegerSchema,
  attemptsLeft: v.optional(nonNegativeIntegerSchema),
  body: nodesSchema<BodyNode>(),
  stimuli: v.array(stimulusSchema),
  stylesheets: v.array(v.string()),
  catalogs: nodesSchema<Catalog>(),
  companionMaterials: v.optional(nodeSchema<CompanionMaterialsInfo>()),
  interactions: v.array(descriptorSchema),
  responses: valuesSchema,
  modalFeedback: nodesSchema<BodyNode>(),
  pci: entriesSchema(pciSchema),
  variant: v.optional(variantSchema),
  hazards: v.array(hazardSchema),
  lti: v.optional(ltiSchema),
});

const viewSchema: Schema<CandidateView> = v.strictObject({
  status: v.picklist(DELIVERY_STATUSES),
  test: v.strictObject({ identifier: v.string(), title: v.string(), stylesheets: v.array(v.string()) }),
  part: v.optional(
    v.strictObject({
      identifier: v.string(),
      navigationMode: v.picklist(NAVIGATION_MODES),
      submissionMode: v.picklist(SUBMISSION_MODES),
    }),
  ),
  navigation: v.array(navigationEntrySchema),
  current: v.optional(itemSchema),
  rubric: nodesSchema<BodyNode>(),
  testFeedback: nodesSchema<BodyNode>(),
  timers: v.array(timerSchema),
  actions: v.array(v.picklist(CANDIDATE_ACTION_TYPES)),
  supports: v.array(supportViewSchema),
});

/**
 * Reads the JSON form of a candidate view, checking it deeply: every property of its form and no other, the type of
 * every field, the values as wire values, and the content as plain JSON nodes.
 *
 * @remarks
 * A view that `writeView` wrote reads back equal. The view comes from the host's own server, which built it from content that
 * passed the limits of the XML reader, so the reader sets no limit of size; it limits the depth of the content to 256 levels.
 * Do not pass it a view that a user sent.
 *
 * @param json - The parsed JSON.
 * @returns The view.
 * @throws `DataError` when it is not the JSON form of a view.
 */
export function readView(json: unknown): CandidateView {
  return parseWith(viewSchema, json, "The view");
}

/**
 * Returns a copy of an item instance's key with its two properties only.
 *
 * @throws `DataError` when it is not a key.
 */
function keyOf(key: unknown): ItemKey {
  checkKey(key);
  return { ref: key.ref, instance: key.instance };
}

/** Checks a map of values; `valuesToJson` checks each value against its own type. */
function checkValues(map: unknown, label: string): asserts map is ReadonlyMap<string, Value | null> {
  if (!(map instanceof Map)) throw new DataError(`${label} must be a Map, found ${describe(map)}.`);
}

function pciToJson(pci: PciView): unknown {
  checkRecord(pci, "The values of a portable custom interaction must be an object");
  checkValues(pci.templateValues, "The templateValues of a portable custom interaction");
  checkValues(pci.contextValues, "The contextValues of a portable custom interaction");
  return { ...pci, templateValues: valuesToJson(pci.templateValues), contextValues: valuesToJson(pci.contextValues) };
}

function ltiToJson(lti: LtiView): unknown {
  checkRecord(lti, "The link to a tool must be an object");
  if (!(lti.custom instanceof Map)) {
    throw new DataError(`The custom properties of the link to a tool must be a Map, found ${describe(lti.custom)}.`);
  }
  return { ...lti, custom: [...lti.custom] };
}

// The writers keep every property of the view they are given, so that one the form does not have reaches the strict
// schema of the form and is refused, instead of being left out.
function itemToJson(item: CandidateItem): unknown {
  checkRecord(item, "The item of the view must be an object");
  checkValues(item.responses, "The responses of the item");
  if (!(item.pci instanceof Map)) {
    throw new DataError(`The portable custom interactions of the item must be a Map, found ${describe(item.pci)}.`);
  }
  return {
    ...item,
    key: keyOf(item.key),
    responses: valuesToJson(item.responses),
    pci: [...item.pci].map(([identifier, pci]) => [identifier, pciToJson(pci)]),
    ...(item.lti === undefined ? {} : { lti: ltiToJson(item.lti) }),
  };
}

/**
 * Writes a candidate view as plain data that `JSON.stringify` keeps whole: values are wire values, NULL is `null`, and
 * maps are arrays of entries, so that an identifier such as `__proto__` stays data.
 *
 * @remarks
 * The result is read back by {@link readView} before it is returned, so that what leaves is what a client reads,
 * and a view with a property the form does not have is refused. The content nodes are shared with the view.
 *
 * @param view - The view.
 * @returns The plain data of the view.
 * @throws `DataError` when the view is not one: it lacks a property of a view or has another, or holds a number that
 * JSON cannot carry.
 */
export function writeView(view: CandidateView): unknown {
  checkRecord(view, "The view must be an object");
  checkArray(view.navigation, "The navigation of the view must be an array");
  const json = {
    ...view,
    navigation: view.navigation.map((entry) => (entry.kind === "item" ? { ...entry, key: keyOf(entry.key) } : entry)),
    ...(view.current === undefined ? {} : { current: itemToJson(view.current) }),
  };
  readView(json);
  return json;
}
