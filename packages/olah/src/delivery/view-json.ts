import type { BodyNode, Catalog, CompanionMaterialsInfo } from "../asi/index.js";
import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkNonNegative,
  checkNonNegativeInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { DataError } from "../errors.js";
import { checkDescriptor } from "../interactions/check-descriptor.js";
import type { InteractionDescriptor } from "../interactions/index.js";
import { isSupportName, PNP_HAZARDS } from "../pnp/index.js";
import type { Value } from "../values/index.js";
import { CANDIDATE_ACTION_TYPES } from "./candidate-actions.js";
import type {
  CandidateItem,
  CandidateView,
  HazardView,
  LtiView,
  NavigationEntry,
  PartView,
  PciView,
  StimulusView,
  SupportView,
  TimerView,
  VariantView,
} from "./candidate-view.js";
import { readEntries, readValues, valuesToJson } from "./entries-json.js";
import { checkKey, type ItemKey } from "./item-key.js";
import { checkNodes, checkPlain, checkShape } from "./json-checks.js";
import { DELIVERY_STATUSES, ITEM_SESSION_STATUSES } from "./names.js";
import { readSessionSupport } from "./support-json.js";

const SCOPES: readonly TimerView["scope"][] = ["item", "section", "part", "test"];
const NAVIGATION_MODES: readonly PartView["navigationMode"][] = ["linear", "nonlinear"];
const SUBMISSION_MODES: readonly PartView["submissionMode"][] = ["individual", "simultaneous"];

/** The properties of the JSON form of a view, and of its item: those it must have, then those it may. */
const VIEW_PROPERTIES = {
  required: ["status", "test", "navigation", "rubric", "testFeedback", "timers", "actions", "supports"],
  optional: ["part", "current"],
} as const;
const ITEM_PROPERTIES = {
  required: [
    "key",
    "title",
    "timeDependent",
    "status",
    "numAttempts",
    "body",
    "stimuli",
    "stylesheets",
    "catalogs",
    "interactions",
    "responses",
    "modalFeedback",
    "pci",
    "hazards",
  ],
  optional: ["label", "language", "attemptsLeft", "companionMaterials", "variant", "lti"],
} as const;

/**
 * Returns a copy of an item instance's key with its two properties only.
 *
 * @throws `DataError` when it is not a key.
 */
function keyOf(key: unknown): ItemKey {
  checkKey(key);
  return { ref: key.ref, instance: key.instance };
}

/** Reads an optional string property. */
function optionalString(value: unknown, label: string): string | undefined {
  if (value !== undefined) checkString(value, label);
  return typeof value === "string" ? value : undefined;
}

// ---- the view ----

function readNavigationEntry(json: unknown): NavigationEntry {
  checkRecord(json, "An entry of the navigation must be an object");
  checkChoice(json.kind, "The kind of an entry of the navigation", ["section", "item"]);
  if (json.kind === "section") {
    checkShape(json, "A section of the navigation", ["kind", "identifier", "title", "depth"]);
    checkString(json.identifier, "The identifier of a section of the navigation");
    checkString(json.title, "The title of a section of the navigation");
    checkNonNegativeInteger(json.depth, "The depth of a section of the navigation");
    return { kind: "section", identifier: json.identifier, title: json.title, depth: json.depth };
  }
  checkShape(json, "An item of the navigation", ["kind", "key", "title", "depth", "status", "current", "reachable"]);
  checkString(json.title, "The title of an item of the navigation");
  checkNonNegativeInteger(json.depth, "The depth of an item of the navigation");
  checkChoice(json.status, "The status of an item of the navigation", ITEM_SESSION_STATUSES);
  checkBoolean(json.current, "The current of an item of the navigation");
  checkBoolean(json.reachable, "The reachable of an item of the navigation");
  return {
    kind: "item",
    key: keyOf(json.key),
    title: json.title,
    depth: json.depth,
    status: json.status,
    current: json.current,
    reachable: json.reachable,
  };
}

function readTimer(json: unknown): TimerView {
  checkShape(json, "A timer", ["scope", "identifier", "late"], ["remaining", "minimumRemaining"]);
  checkChoice(json.scope, "The scope of a timer", SCOPES);
  checkString(json.identifier, "The identifier of a timer");
  checkBoolean(json.late, "The late of a timer");
  const { remaining, minimumRemaining } = json;
  if (remaining !== undefined) checkNonNegative(remaining, "The remaining of a timer");
  if (minimumRemaining !== undefined) checkNonNegative(minimumRemaining, "The minimumRemaining of a timer");
  return {
    scope: json.scope,
    identifier: json.identifier,
    ...(remaining === undefined ? {} : { remaining }),
    ...(minimumRemaining === undefined ? {} : { minimumRemaining }),
    late: json.late,
  };
}

function readSupportView(json: unknown): SupportView {
  checkShape(json, "A support", ["name", "state", "active"], ["settings"]);
  const { name } = json;
  if (!isSupportName(name)) {
    throw new DataError(`The name of a support must be the name of a support of a PNP, found ${describe(name)}.`);
  }
  const { state, active, settings } = readSessionSupport(json, name);
  return { name, state, active, ...(settings === undefined ? {} : { settings }) };
}

// ---- the item ----

function readStimulus(json: unknown): StimulusView {
  checkShape(json, "A stimulus", ["identifier", "body"]);
  checkString(json.identifier, "The identifier of a stimulus");
  checkNodes(json.body, "The body of a stimulus");
  return { identifier: json.identifier, body: json.body as readonly BodyNode[] };
}

function readHazard(json: unknown): HazardView {
  checkShape(json, "A hazard", ["hazard", "avoided"]);
  checkChoice(json.hazard, "The hazard of a hazard", PNP_HAZARDS);
  checkBoolean(json.avoided, "The avoided of a hazard");
  return { hazard: json.hazard, avoided: json.avoided };
}

function readPci(json: unknown): PciView {
  checkShape(json, "The values of a portable custom interaction", ["templateValues", "contextValues"], ["state"]);
  if (json.state !== undefined) checkString(json.state, "The state of a portable custom interaction");
  return {
    templateValues: readValues(json.templateValues, "The templateValues of a portable custom interaction"),
    contextValues: readValues(json.contextValues, "The contextValues of a portable custom interaction"),
    ...(json.state === undefined ? {} : { state: json.state }),
  };
}

function readLti(json: unknown): LtiView {
  checkShape(json, "The link to a tool", ["title", "custom"], ["description", "launchUrl", "secureLaunchUrl"]);
  checkString(json.title, "The title of the link to a tool");
  const description = optionalString(json.description, "The description of the link to a tool");
  const launchUrl = optionalString(json.launchUrl, "The launchUrl of the link to a tool");
  const secureLaunchUrl = optionalString(json.secureLaunchUrl, "The secureLaunchUrl of the link to a tool");
  return {
    title: json.title,
    ...(description === undefined ? {} : { description }),
    ...(launchUrl === undefined ? {} : { launchUrl }),
    ...(secureLaunchUrl === undefined ? {} : { secureLaunchUrl }),
    custom: readEntries(json.custom, "The custom properties of the link to a tool", (value, name) => {
      checkString(value, `The custom property ${describe(name)} of the link to a tool`);
      return value;
    }),
  };
}

function readDescriptors(json: unknown): InteractionDescriptor[] {
  checkArray(json, "The interactions of the item must be an array");
  return json.map((descriptor) => {
    checkPlain(descriptor, "An interaction of the item");
    checkDescriptor(descriptor);
    return descriptor;
  });
}

function readVariant(json: unknown): VariantView {
  checkShape(json, "The variant", ["resource"], ["language"]);
  checkString(json.resource, "The resource of the variant");
  if (json.language !== undefined) checkString(json.language, "The language of the variant");
  return { resource: json.resource, ...(json.language === undefined ? {} : { language: json.language }) };
}

function readStrings(json: unknown, label: string): string[] {
  checkArray(json, `${label} must be an array of strings`);
  return json.map((entry) => {
    checkString(entry, `An entry of ${label}`);
    return entry;
  });
}

function readItem(json: unknown): CandidateItem {
  checkShape(json, "The item of the view", ITEM_PROPERTIES.required, ITEM_PROPERTIES.optional);
  checkString(json.title, "The title of the item");
  checkBoolean(json.timeDependent, "The timeDependent of the item");
  checkChoice(json.status, "The status of the item", ITEM_SESSION_STATUSES);
  checkNonNegativeInteger(json.numAttempts, "The numAttempts of the item");
  if (json.attemptsLeft !== undefined) checkNonNegativeInteger(json.attemptsLeft, "The attemptsLeft of the item");
  checkNodes(json.body, "The body of the item");
  checkNodes(json.catalogs, "The catalogs of the item");
  checkNodes(json.modalFeedback, "The modal feedback of the item");
  checkArray(json.stimuli, "The stimuli of the item must be an array");
  checkArray(json.hazards, "The hazards of the item must be an array");
  if (json.companionMaterials !== undefined)
    checkNodes([json.companionMaterials], "The companion materials of the item");
  const { attemptsLeft, companionMaterials, variant, lti } = json;
  const label = optionalString(json.label, "The label of the item");
  const language = optionalString(json.language, "The language of the item");
  return {
    key: keyOf(json.key),
    title: json.title,
    ...(label === undefined ? {} : { label }),
    ...(language === undefined ? {} : { language }),
    timeDependent: json.timeDependent,
    status: json.status,
    numAttempts: json.numAttempts,
    ...(attemptsLeft === undefined ? {} : { attemptsLeft }),
    body: json.body as readonly BodyNode[],
    stimuli: json.stimuli.map(readStimulus),
    stylesheets: readStrings(json.stylesheets, "The stylesheets of the item"),
    catalogs: json.catalogs as readonly Catalog[],
    ...(companionMaterials === undefined ? {} : { companionMaterials: companionMaterials as CompanionMaterialsInfo }),
    interactions: readDescriptors(json.interactions),
    responses: readValues(json.responses, "The responses of the item"),
    modalFeedback: json.modalFeedback as readonly BodyNode[],
    pci: readEntries(json.pci, "The portable custom interactions of the item", readPci),
    ...(variant === undefined ? {} : { variant: readVariant(variant) }),
    hazards: json.hazards.map(readHazard),
    ...(lti === undefined ? {} : { lti: readLti(lti) }),
  };
}

/**
 * Reads the JSON form of a candidate view, checking it deeply: every property of its form and no other, the type of
 * every field, the values as wire values, and the content as plain JSON nodes. A view that `viewToJson` wrote reads back
 * equal (E30).
 *
 * @param json - The parsed JSON.
 * @throws `DataError` when it is not the JSON form of a view.
 */
export function viewFromJson(json: unknown): CandidateView {
  checkShape(json, "The view", VIEW_PROPERTIES.required, VIEW_PROPERTIES.optional);
  checkChoice(json.status, "The status of the view", DELIVERY_STATUSES);
  checkShape(json.test, "The test of the view", ["identifier", "title"]);
  checkString(json.test.identifier, "The identifier of the test of the view");
  checkString(json.test.title, "The title of the test of the view");
  checkArray(json.navigation, "The navigation of the view must be an array");
  checkNodes(json.rubric, "The rubric of the view");
  checkNodes(json.testFeedback, "The test feedback of the view");
  checkArray(json.timers, "The timers of the view must be an array");
  checkArray(json.actions, "The actions of the view must be an array");
  checkArray(json.supports, "The supports of the view must be an array");
  const { part, current } = json;
  let partView: CandidateView["part"];
  if (part !== undefined) {
    checkShape(part, "The test part of the view", ["identifier", "navigationMode", "submissionMode"]);
    checkString(part.identifier, "The identifier of the test part of the view");
    checkChoice(part.navigationMode, "The navigationMode of the test part of the view", NAVIGATION_MODES);
    checkChoice(part.submissionMode, "The submissionMode of the test part of the view", SUBMISSION_MODES);
    partView = {
      identifier: part.identifier,
      navigationMode: part.navigationMode,
      submissionMode: part.submissionMode,
    };
  }
  return {
    status: json.status,
    test: { identifier: json.test.identifier, title: json.test.title },
    ...(partView === undefined ? {} : { part: partView }),
    navigation: json.navigation.map(readNavigationEntry),
    ...(current === undefined ? {} : { current: readItem(current) }),
    rubric: json.rubric as readonly BodyNode[],
    testFeedback: json.testFeedback as readonly BodyNode[],
    timers: json.timers.map(readTimer),
    actions: json.actions.map((type) => {
      checkChoice(type, "An action of the view", CANDIDATE_ACTION_TYPES);
      return type;
    }),
    supports: json.supports.map(readSupportView),
  };
}

// ---- writing ----

/** Checks a map of values; `valuesToJson` checks each value against its own type. */
function checkValues(map: unknown, label: string): asserts map is ReadonlyMap<string, Value | null> {
  if (!(map instanceof Map)) throw new DataError(`${label} must be a Map, found ${describe(map)}.`);
}

/** Returns a copy of an object of the view, so that a property the form does not have reaches the check of the form. */
function copyOf(value: unknown, label: string): Readonly<Record<string, unknown>> {
  checkRecord(value, `${label} must be an object`);
  return { ...value };
}

function pciToJson(pci: PciView): unknown {
  checkRecord(pci, "The values of a portable custom interaction must be an object");
  checkValues(pci.templateValues, "The templateValues of a portable custom interaction");
  checkValues(pci.contextValues, "The contextValues of a portable custom interaction");
  return {
    templateValues: valuesToJson(pci.templateValues),
    contextValues: valuesToJson(pci.contextValues),
    ...(pci.state === undefined ? {} : { state: pci.state }),
  };
}

function ltiToJson(lti: LtiView): unknown {
  checkRecord(lti, "The link to a tool must be an object");
  if (!(lti.custom instanceof Map)) {
    throw new DataError(`The custom properties of the link to a tool must be a Map, found ${describe(lti.custom)}.`);
  }
  return {
    title: lti.title,
    ...(lti.description === undefined ? {} : { description: lti.description }),
    ...(lti.launchUrl === undefined ? {} : { launchUrl: lti.launchUrl }),
    ...(lti.secureLaunchUrl === undefined ? {} : { secureLaunchUrl: lti.secureLaunchUrl }),
    custom: [...lti.custom],
  };
}

function itemToJson(item: CandidateItem): unknown {
  checkShape(item, "The item of the view", ITEM_PROPERTIES.required, ITEM_PROPERTIES.optional);
  checkRecord(item.key, "The key of the item must be an object");
  checkValues(item.responses, "The responses of the item");
  if (!(item.pci instanceof Map)) {
    throw new DataError(`The portable custom interactions of the item must be a Map, found ${describe(item.pci)}.`);
  }
  checkArray(item.stimuli, "The stimuli of the item must be an array");
  checkArray(item.hazards, "The hazards of the item must be an array");
  return {
    key: keyOf(item.key),
    title: item.title,
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(item.language === undefined ? {} : { language: item.language }),
    timeDependent: item.timeDependent,
    status: item.status,
    numAttempts: item.numAttempts,
    ...(item.attemptsLeft === undefined ? {} : { attemptsLeft: item.attemptsLeft }),
    body: item.body,
    stimuli: item.stimuli.map((stimulus) => copyOf(stimulus, "A stimulus")),
    stylesheets: item.stylesheets,
    catalogs: item.catalogs,
    ...(item.companionMaterials === undefined ? {} : { companionMaterials: item.companionMaterials }),
    interactions: item.interactions,
    responses: valuesToJson(item.responses),
    modalFeedback: item.modalFeedback,
    pci: [...item.pci].map(([identifier, pci]) => [identifier, pciToJson(pci)]),
    ...(item.variant === undefined ? {} : { variant: copyOf(item.variant, "The variant") }),
    hazards: item.hazards.map((hazard) => copyOf(hazard, "A hazard")),
    ...(item.lti === undefined ? {} : { lti: ltiToJson(item.lti) }),
  };
}

/**
 * Writes a candidate view as plain data that `JSON.stringify` keeps whole (R1, E30): values are wire values, NULL is
 * `null`, and maps are arrays of entries, so that an identifier such as `__proto__` stays data. The result is built
 * property by property from the view, and read back by {@link viewFromJson} before it is returned, so that what leaves
 * is what a client reads. The content nodes are shared with the view.
 *
 * @throws `DataError` when the view is not one: it lacks a property of a view or has another, or holds a number that JSON
 * cannot carry.
 */
export function viewToJson(view: CandidateView): unknown {
  checkShape(view, "The view", VIEW_PROPERTIES.required, VIEW_PROPERTIES.optional);
  checkRecord(view.test, "The test of the view must be an object");
  checkArray(view.navigation, "The navigation of the view must be an array");
  checkArray(view.timers, "The timers of the view must be an array");
  checkArray(view.supports, "The supports of the view must be an array");
  const json = {
    status: view.status,
    test: { identifier: view.test.identifier, title: view.test.title },
    ...(view.part === undefined ? {} : { part: copyOf(view.part, "The test part of the view") }),
    navigation: view.navigation.map((entry) => {
      const copy = copyOf(entry, "An entry of the navigation");
      return entry.kind === "item" ? { ...copy, key: keyOf(entry.key) } : copy;
    }),
    ...(view.current === undefined ? {} : { current: itemToJson(view.current) }),
    rubric: view.rubric,
    testFeedback: view.testFeedback,
    timers: view.timers.map((timer) => copyOf(timer, "A timer")),
    actions: view.actions,
    supports: view.supports.map((support) => copyOf(support, "A support")),
  };
  viewFromJson(json);
  return json;
}
