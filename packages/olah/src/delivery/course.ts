import type { AssessmentItem, AssessmentTest, ItemSessionControl, ResponseProcessing } from "../asi/index.js";
import { checkFunction, checkOptions, checkPositiveInteger, checkRecord, checkString, describe } from "../checks.js";
import { type DrdHazardTerm, HAZARD_TERMS } from "../content/index.js";
import { DataError, type Issue } from "../errors.js";
import type { DeliverableItem, ResolvedItem, Resolvers } from "../package/index.js";
import { resolveReference } from "../package/index.js";
import type { VariableType } from "../processing/assign.js";
import {
  BUILT_IN_CONTEXTS,
  type CustomOperator,
  DEFAULT_PROCESSING_LIMITS,
  declaredValue,
  type ProcessingLimits,
} from "../processing/index.js";
import { checkItem, initialOutcome } from "../processing/variables.js";
import { validateAsi, validateTest } from "../validate/index.js";
import type { Value } from "../values/index.js";
import { ltiItem } from "./lti-item.js";
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from "./plan.js";
import { type EffectiveSessionControl, sessionControl, standaloneSessionControl } from "./session-control.js";
import { standaloneTest } from "./standalone.js";
import { type ContentNode, type ItemRefNode, resolveStructure, type TestStructure } from "./structure.js";

/**
 * What the engine delivers: a test, or an item alone for practice (E12).
 *
 * - `test`: the test, the path of its document, and the resolvers of its references, such as those of
 *   `packageResolvers`.
 * - `item`: the item, the path of its document, and the item session control that the host gives it, if any.
 */
export type DeliveryDefinition =
  | {
      /** Delivers a test. */
      readonly kind: "test";
      /** The test, as `readAsi` reads it, with its includes resolved. */
      readonly test: AssessmentTest;
      /** The path of the test document, against which its references resolve. */
      readonly base: string;
      /** The resolvers of the references of the test. */
      readonly resolvers: Resolvers;
    }
  | {
      /** Delivers an item alone. */
      readonly kind: "item";
      /** The item, as `readAsi` reads it, with its includes resolved. */
      readonly item: AssessmentItem;
      /** The path of the item document, named in the issues of the static checks. */
      readonly base: string;
      /** The item session control of the item, as `standaloneSessionControl` applies it. Default: none. */
      readonly control?: ItemSessionControl;
    };

/** The options of `createEngine`. */
export interface EngineOptions {
  /** The custom operators, by the `definition` of a `qti-custom-operator`, else by its `class`. Default: none. */
  readonly customOperators?: ReadonlyMap<string, CustomOperator>;
  /**
   * Returns the response processing that a template URI names, for templates other than the six standard ones.
   * Default: none.
   */
  readonly resolveTemplate?: (uri: string) => ResponseProcessing | undefined;
  /**
   * Limits that replace those of `DEFAULT_PROCESSING_LIMITS` and `DEFAULT_PLAN_LIMITS`; a limit left out keeps its
   * default. Default: none.
   */
  readonly limits?: Partial<ProcessingLimits & PlanLimits>;
}

/** An item that an item instance may present: the item an item reference names, or one of its variants. */
export interface Candidate {
  /** The manifest resource; for an item delivered alone, the identifier of the item. */
  readonly resource: string;
  /** The item; a link to a tool is modeled as an item (E25). */
  readonly item: AssessmentItem;
  /** The hazards of the resource, in the terms of the DRD (B99). */
  readonly hazards: readonly DrdHazardTerm[];
  /** The languages of a variant's adaptation, BCP 47 tags; none for the item itself. */
  readonly languages: readonly string[];
}

/** An item reference of the test, with what its instances present. */
export interface CourseItem {
  /** The item reference in the structure. */
  readonly node: ItemRefNode;
  /** The item session control of its instances. */
  readonly control: EffectiveSessionControl;
  /** The item, then its variants in the order of the manifest (B100). */
  readonly candidates: readonly [Candidate, ...Candidate[]];
}

/**
 * What every session of an engine shares: the test with its references resolved, the item of each item reference, the
 * starting values of the test's variables, and the options of processing.
 */
export interface Course {
  /** The test, with its section references resolved; a synthesized test of one item for an item delivered alone. */
  readonly structure: TestStructure;
  /** The item references, by identifier. */
  readonly items: ReadonlyMap<string, CourseItem>;
  /** The starting value of each outcome of the test (INFO §2.2.2.3, §2.9). */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The default value of each context variable of the test (INFO §2.2.2.1). */
  readonly contexts: ReadonlyMap<string, Value | null>;
  /** Every declaration of each context variable, the test's and the items', and `QTI_CONTEXT`, by identifier. */
  readonly contextTypes: ReadonlyMap<string, readonly VariableType[]>;
  /** The custom operators. */
  readonly customOperators: ReadonlyMap<string, CustomOperator>;
  /** The resolver of templates. */
  readonly resolveTemplate: ((uri: string) => ResponseProcessing | undefined) | undefined;
  /** The limits of processing and planning. */
  readonly limits: ProcessingLimits & PlanLimits;
}

/**
 * Returns the candidate that an item instance presents: the variant of the resource given, else the item itself.
 *
 * @throws `DataError` when the item reference has no such variant.
 */
export function candidateOf(entry: CourseItem, variant: string | undefined): Candidate {
  if (variant === undefined) return entry.candidates[0];
  const candidate = entry.candidates.find((each) => each.resource === variant);
  if (candidate === undefined) {
    throw new DataError(
      `The item reference ${describe(entry.node.model.identifier)} has no variant ${describe(variant)}.`,
    );
  }
  return candidate;
}

/** Returns the context values that an item reads: those of the variables it declares, and `QTI_CONTEXT` (B50). */
export function itemContextValues(
  values: ReadonlyMap<string, Value | null>,
  item: AssessmentItem,
): ReadonlyMap<string, Value | null> {
  return new Map(
    [...values].filter(
      ([identifier]) =>
        BUILT_IN_CONTEXTS.has(identifier) ||
        item.contextDeclarations.some((declaration) => declaration.identifier === identifier),
    ),
  );
}

/** The kind of the model of `qti-assessment-test`. */
const TEST_KIND = "assessment-test";

/** Checks the options of `createEngine` and applies their defaults. */
function checkEngineOptions(options: EngineOptions): Pick<Course, "customOperators" | "resolveTemplate" | "limits"> {
  checkOptions(options);
  const { customOperators = new Map<string, CustomOperator>(), resolveTemplate, limits = {} } = options;
  if (!(customOperators instanceof Map)) {
    throw new DataError(
      `The option customOperators must be a Map from a definition or class to a function, found ${describe(customOperators)}.`,
    );
  }
  for (const [name, operator] of customOperators) {
    checkString(name, "The name of a custom operator");
    checkFunction(operator, `The custom operator ${describe(name)} must be a function`);
  }
  if (resolveTemplate !== undefined) checkFunction(resolveTemplate, "The option resolveTemplate must be a function");
  checkRecord(limits, "The option limits must be an object");
  const {
    maxContainerSize = DEFAULT_PROCESSING_LIMITS.maxContainerSize,
    maxPlanNodes = DEFAULT_PLAN_LIMITS.maxPlanNodes,
  } = limits;
  checkPositiveInteger(maxContainerSize, "The limit maxContainerSize");
  checkPositiveInteger(maxPlanNodes, "The limit maxPlanNodes");
  return { customOperators, resolveTemplate, limits: { maxContainerSize, maxPlanNodes } };
}

/**
 * Throws the errors of the static checks, which would fail when a session runs (E26).
 *
 * @throws `DataError` when an issue is an error.
 */
function gate(issues: readonly Issue[], what: string): void {
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) return;
  const listed = errors.map((issue) => {
    const where = issue.location?.path === undefined ? "" : ` in ${issue.location.path}`;
    return `${issue.code}${where}: ${issue.message}`;
  });
  throw new DataError(
    `The ${what} cannot be delivered: the static checks found ${errors.length === 1 ? "an error" : `${errors.length} errors`}. ${listed.join(" ")}`,
  );
}

/** Returns the item that a deliverable presents: a QTI item, or the model of a link to a tool (E25). */
function itemOf(deliverable: DeliverableItem): AssessmentItem {
  return deliverable.kind === "qti" ? deliverable.item : ltiItem(deliverable.identifier);
}

const isDrdHazard = (term: string): term is DrdHazardTerm => [...HAZARD_TERMS.keys()].some((known) => known === term);

/** Returns the item and the variants of a resolved item reference. */
function candidatesOf(resolved: ResolvedItem): readonly [Candidate, ...Candidate[]] {
  const own: Candidate = {
    resource: resolved.resource,
    item: itemOf(resolved.deliverable),
    hazards: resolved.hazards,
    languages: [],
  };
  const variants = resolved.variants.map((variant) => ({
    resource: variant.resource,
    item: itemOf(variant.deliverable),
    hazards: variant.drd.hazard.filter(isDrdHazard),
    languages: variant.drd.languageOfAdaptation,
  }));
  return [own, ...variants];
}

/** Returns the item references of a structure in document order. */
function itemRefsOf(structure: TestStructure): ItemRefNode[] {
  const below = (node: ContentNode): ItemRefNode[] =>
    node.kind === "item-ref" ? [node] : node.children.flatMap(below);
  return structure.test.parts.flatMap((part) => part.sections.flatMap(below));
}

/** Builds a course from a structure and the item references with their items. */
function courseOf(
  structure: TestStructure,
  items: ReadonlyMap<string, CourseItem>,
  options: Pick<Course, "customOperators" | "resolveTemplate" | "limits">,
): Course {
  const test = structure.test.model;
  const outcomes = new Map<string, Value | null>();
  for (const declaration of test.outcomeDeclarations) {
    const what = `The default value of ${declaration.identifier}`;
    outcomes.set(
      declaration.identifier,
      initialOutcome(declaration, declaredValue(declaration.defaultValue?.values, declaration, what)),
    );
  }
  const contexts = new Map<string, Value | null>();
  const contextTypes = new Map<string, VariableType[]>([...BUILT_IN_CONTEXTS].map(([name, type]) => [name, [type]]));
  const declare = (identifier: string, type: VariableType): void => {
    contextTypes.set(identifier, [...(contextTypes.get(identifier) ?? []), type]);
  };
  for (const declaration of test.contextDeclarations) {
    const what = `The default value of ${declaration.identifier}`;
    contexts.set(declaration.identifier, declaredValue(declaration.defaultValue?.values, declaration, what));
    declare(declaration.identifier, declaration);
  }
  for (const { candidates } of items.values()) {
    for (const { item } of candidates) {
      for (const declaration of item.contextDeclarations) declare(declaration.identifier, declaration);
    }
  }
  return { structure, items, outcomes, contexts, contextTypes, ...options };
}

/** Builds the course of a test: the static checks, then the structure and every item it can reach. */
function testCourse(definition: Extract<DeliveryDefinition, { kind: "test" }>, options: EngineOptions): Course {
  const { test, base, resolvers } = definition;
  checkRecord(test, "The test must be an object of the model of qti-assessment-test");
  if (test.kind !== TEST_KIND) {
    throw new DataError(`The test must be the model of a qti-assessment-test, found the kind ${describe(test.kind)}.`);
  }
  checkString(base, "The base");
  const checked = checkEngineOptions(options);
  gate(validateTest(test, base, resolvers, checked), "test");
  const structure = resolveStructure(test, base, resolvers);
  const resolved = new Map<string, ResolvedItem>();
  const items = new Map<string, CourseItem>();
  for (const node of itemRefsOf(structure)) {
    const path = resolveReference(node.base, node.model.href) ?? node.model.href;
    const item = resolved.get(path) ?? resolvers.items(node.model.href, node.base);
    resolved.set(path, item);
    items.set(node.model.identifier, { node, control: sessionControl(node), candidates: candidatesOf(item) });
  }
  return courseOf(structure, items, checked);
}

/** Builds the course of an item delivered alone: a test of one nonlinear part with the item (E12). */
function itemCourse(definition: Extract<DeliveryDefinition, { kind: "item" }>, options: EngineOptions): Course {
  const { item, base, control } = definition;
  checkItem(item);
  checkString(base, "The base");
  const checked = checkEngineOptions(options);
  const effective = standaloneSessionControl(control);
  gate(validateAsi({ kind: "item", item }, { ...checked, path: base }), "item");
  const structure = standaloneTest(item);
  const node = structure.itemRef(item.identifier);
  if (node === undefined)
    throw new DataError(`The test of the item has no item reference ${describe(item.identifier)}.`);
  const own: Candidate = { resource: item.identifier, item, hazards: [], languages: [] };
  return courseOf(structure, new Map([[item.identifier, { node, control: effective, candidates: [own] }]]), checked);
}

/**
 * Builds the course of a definition, after the static checks (E26).
 *
 * @throws `DataError` when an argument has the wrong type, or the static checks find an error.
 * @throws `ReadError` from a resolver, when a reference cannot be resolved after the checks.
 */
export function buildCourse(definition: DeliveryDefinition, options: EngineOptions): Course {
  checkRecord(definition, "The definition must be an object with a kind");
  switch (definition.kind) {
    case "test":
      return testCourse(definition, options);
    case "item":
      return itemCourse(definition, options);
    default:
      throw new DataError(
        `The kind of the definition must be "test" or "item", found ${describe(Reflect.get(definition, "kind"))}.`,
      );
  }
}
