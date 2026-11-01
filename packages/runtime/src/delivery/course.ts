import {
  type AssessmentItem,
  type AssessmentStimulus,
  type AssessmentTest,
  type ItemSessionControl,
  type ResponseProcessing,
  readScoreCovers,
  type ScoreCover,
} from "../asi/index.js";
import {
  checkFunction,
  checkNonEmptyString,
  checkOptions,
  checkPositiveInteger,
  checkRecord,
  checkString,
  checkSynchronous,
  describe,
} from "../checks.js";
import { type DrdHazardTerm, HAZARD_TERMS } from "../content/index.js";
import { DataError, type Issue } from "../errors.js";
import type { DeliverableItem, LtiLink, ResolvedItem, Resolvers } from "../package/index.js";
import { resolveReference } from "../package/index.js";
import {
  BUILT_IN_CONTEXTS,
  type CustomOperator,
  declaredValue,
  type ProcessingLimits,
  type VariableType,
} from "../processing/index.js";
import { checkItem, checkProcessingOptions, initialOutcome } from "../processing/internal.js";
import { validateAsi, validateTest } from "../validate/index.js";
import type { Value } from "../values/index.js";
import type { CatSectionRef } from "./cat-session.js";
import { ltiItem } from "./lti-item.js";
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from "./plan.js";
import { type EffectiveSessionControl, sessionControl, standaloneSessionControl } from "./session-control.js";
import { standaloneTest } from "./standalone.js";
import {
  type ContentNode,
  type ItemRefNode,
  resolveStructure,
  type SectionNode,
  type TestStructure,
} from "./structure.js";

/**
 * What the engine delivers: a test, or an item alone for practice.
 *
 * @remarks
 * - `test`: the test, the path of its document, the resolvers of its references, such as those of `packageResolvers`,
 *   and where the CAT engine of each adaptive section is.
 * - `item`: the item, the path of its document, the resolver of the stimuli it names, and the item session control that
 *   the host gives it, if any.
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
      /**
       * The CAT engine of each adaptive section, by the identifier of the section: the URL prefix of the engine and the
       * identifier that `CatPort.createSection` returned when the host deployed the section. The test needs an entry
       * for each of its adaptive sections and for no other section.
       *
       * @defaultValue none
       */
      readonly catSections?: ReadonlyMap<string, CatSectionRef>;
    }
  | {
      /** Delivers an item alone. */
      readonly kind: "item";
      /** The item, as `readAsi` reads it, with its includes resolved. */
      readonly item: AssessmentItem;
      /** The path of the item document, named in the issues of the static checks; its references resolve against it. */
      readonly base: string;
      /**
       * The resolver of the stimuli the item names, such as that of `packageResolvers`.
       *
       * @defaultValue none, so that an item that names a stimulus presents it without one
       */
      readonly resolvers?: Pick<Resolvers, "stimuli">;
      /**
       * The item session control of the item, as `standaloneSessionControl` applies it.
       *
       * @defaultValue none
       */
      readonly control?: ItemSessionControl;
    };

/** The options of `createEngine`. */
export interface EngineOptions {
  /**
   * The custom operators, by the `definition` of a `qti-custom-operator`, else by its `class`.
   *
   * @defaultValue none
   */
  readonly customOperators?: ReadonlyMap<string, CustomOperator>;
  /**
   * Returns the response processing that a template URI names, for templates other than the six standard ones.
   *
   * @defaultValue none
   */
  readonly resolveTemplate?: (uri: string) => ResponseProcessing | undefined;
  /**
   * Limits that replace those of `DEFAULT_PROCESSING_LIMITS` and `DEFAULT_PLAN_LIMITS`; a limit left out keeps its
   * default.
   *
   * @defaultValue none
   */
  readonly limits?: Partial<ProcessingLimits & PlanLimits>;
  /**
   * The version of the content, as the host names it, such as a hash of the package. A session keeps it, and the engine
   * refuses a state that another version started.
   *
   * @defaultValue none, so that the engine checks no state and starts sessions that name no version
   */
  readonly contentVersion?: string;
}

/** A stimulus that an item names, with the path of its document. */
interface CandidateStimulus {
  /** The stimulus as `readAsi` reads it. */
  readonly stimulus: AssessmentStimulus;
  /** The package path of its document, against which its references resolve; absent when the item's path is not known. */
  readonly path?: string;
}

/** An item that an item instance may present: the item an item reference names, or one of its variants. */
export interface Candidate {
  /** The manifest resource; for an item delivered alone, the identifier of the item. */
  readonly resource: string;
  /** The item; a link to a tool is modeled as an item. */
  readonly item: AssessmentItem;
  /** The link to a tool that the item models; absent for a QTI item. */
  readonly link?: LtiLink;
  /**
   * The package path of the document of the item, against which its references resolve; absent for a variant, whose
   * path the resolvers do not give.
   */
  readonly path?: string;
  /** The stimuli the item names, in the order it names them. */
  readonly stimuli: readonly CandidateStimulus[];
  /** The hazards of the resource, in the terms of the DRD. */
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
  /** The item, then its variants in the order of the manifest. */
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
  /** The starting value of each outcome of the test. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The default value of each context variable of the test. */
  readonly contexts: ReadonlyMap<string, Value | null>;
  /** Every declaration of each context variable, the test's and the items', and `QTI_CONTEXT`, by identifier. */
  readonly contextTypes: ReadonlyMap<string, readonly VariableType[]>;
  /** The custom operators. */
  readonly customOperators: ReadonlyMap<string, CustomOperator>;
  /** The resolver of templates. */
  readonly resolveTemplate: ((uri: string) => ResponseProcessing | undefined) | undefined;
  /** The limits of processing and planning. */
  readonly limits: ProcessingLimits & PlanLimits;
  /** The version of the content that the host names; `undefined` when it names none. */
  readonly contentVersion: string | undefined;
  /** The CAT engine of each adaptive section of the test, by the identifier of the section. */
  readonly catSections: ReadonlyMap<string, CatSectionRef>;
  /** The covers of the externally scored outcomes of the test, by outcome identifier. */
  readonly covers: ReadonlyMap<string, readonly ScoreCover[]>;
  /** Whether the course delivers one item alone, so that no test exists to report on. */
  readonly standalone: boolean;
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

/** Returns the title that the candidate sees: the title of the link for an item that models a link to a tool. */
export function candidateTitle(candidate: Candidate): string {
  return candidate.link?.title ?? candidate.item.title;
}

/** Returns the context values that an item reads: those of the variables it declares, and `QTI_CONTEXT`. */
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
function checkEngineOptions(
  options: EngineOptions,
): Pick<Course, "customOperators" | "resolveTemplate" | "limits" | "contentVersion"> {
  checkOptions(options);
  const { customOperators, resolveTemplate, limits: processing } = checkProcessingOptions(options);
  const { maxPlanNodes = DEFAULT_PLAN_LIMITS.maxPlanNodes } = options.limits ?? {};
  checkPositiveInteger(maxPlanNodes, "The limit maxPlanNodes");
  const { contentVersion } = options;
  if (contentVersion !== undefined) checkNonEmptyString(contentVersion, "The option contentVersion");
  return { customOperators, resolveTemplate, limits: { ...processing, maxPlanNodes }, contentVersion };
}

/**
 * Throws the errors of the static checks, which would fail when a session runs.
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

/** Returns the item that a deliverable presents: a QTI item, or the model of a link to a tool. */
function itemOf(deliverable: DeliverableItem): AssessmentItem {
  return deliverable.kind === "qti" ? deliverable.item : ltiItem(deliverable.identifier);
}

const isDrdHazard = (term: string): term is DrdHazardTerm => [...HAZARD_TERMS.keys()].some((known) => known === term);

/**
 * Returns the stimuli an item names, each resolved against the document of the item. Without resolvers an item has
 * none.
 */
function stimuliOf(
  item: AssessmentItem,
  path: string | undefined,
  resolvers: Pick<Resolvers, "stimuli"> | undefined,
): CandidateStimulus[] {
  if (resolvers === undefined) return [];
  return item.stimulusRefs.map((ref) => {
    const stimulusPath = path === undefined ? undefined : resolveReference(path, ref.href);
    const stimulus = resolvers.stimuli(ref.href, path ?? "");
    checkSynchronous(stimulus, "The resolver stimuli");
    return { stimulus, ...(stimulusPath === undefined ? {} : { path: stimulusPath }) };
  });
}

/** Returns the candidate that a deliverable makes: the item it presents, with its link and stimuli. */
function makeCandidate(
  resource: string,
  deliverable: DeliverableItem,
  extra: Pick<Candidate, "hazards" | "languages">,
  path: string | undefined,
  resolvers: Pick<Resolvers, "stimuli"> | undefined,
): Candidate {
  const item = itemOf(deliverable);
  return {
    resource,
    item,
    ...(deliverable.kind === "lti" ? { link: deliverable.link } : {}),
    ...(path === undefined ? {} : { path }),
    stimuli: stimuliOf(item, path, resolvers),
    ...extra,
  };
}

/**
 * Returns the item and the variants of a resolved item reference. The path is that of the item's document; the
 * variants' paths are not known to the resolvers.
 */
function candidatesOf(
  resolved: ResolvedItem,
  path: string,
  resolvers: Pick<Resolvers, "stimuli">,
): readonly [Candidate, ...Candidate[]] {
  const own = makeCandidate(
    resolved.resource,
    resolved.deliverable,
    { hazards: resolved.hazards, languages: [] },
    path,
    resolvers,
  );
  const variants = resolved.variants.map((variant) =>
    makeCandidate(
      variant.resource,
      variant.deliverable,
      { hazards: variant.drd.hazard.filter(isDrdHazard), languages: variant.drd.languageOfAdaptation },
      undefined,
      resolvers,
    ),
  );
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
  options: Pick<Course, "customOperators" | "resolveTemplate" | "limits" | "contentVersion">,
  adaptive: Pick<Course, "catSections" | "standalone">,
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
  return { structure, items, outcomes, contexts, contextTypes, covers: readScoreCovers(test), ...options, ...adaptive };
}

/**
 * Returns the adaptive sections of a structure in document order.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function adaptiveSectionsOf(structure: TestStructure): SectionNode[] {
  const below = (section: SectionNode): SectionNode[] => [
    ...(section.model.adaptiveSelection === undefined ? [] : [section]),
    ...section.children.flatMap((child) => (child.kind === "section" ? below(child) : [])),
  ];
  return structure.test.parts.flatMap((part) => part.sections.flatMap(below));
}

/**
 * Checks the CAT engines of the adaptive sections: each adaptive section has one, and each entry names an adaptive
 * section.
 *
 * @throws `DataError` when the entries are not a Map of prefix and identifier, or do not match the adaptive sections.
 */
function checkCatSections(structure: TestStructure, given: unknown): ReadonlyMap<string, CatSectionRef> {
  if (!(given instanceof Map)) {
    throw new DataError(
      `The catSections of the definition must be a Map from the identifier of an adaptive section to its prefix and identifier, found ${describe(given)}.`,
    );
  }
  const adaptive = adaptiveSectionsOf(structure).map(({ model }) => model.identifier);
  for (const [identifier, ref] of given) {
    checkString(identifier, "An identifier of the catSections of the definition");
    checkRecord(ref, `The entry ${describe(identifier)} of the catSections of the definition must be an object`);
    checkString(ref.prefix, `The prefix of the entry ${describe(identifier)} of the catSections`);
    checkString(ref.sectionIdentifier, `The sectionIdentifier of the entry ${describe(identifier)} of the catSections`);
    if (!adaptive.includes(identifier)) {
      throw new DataError(
        `The catSections of the definition has an entry for ${describe(identifier)}, which is not an adaptive section of the test.`,
      );
    }
  }
  for (const identifier of adaptive) {
    if (!given.has(identifier)) {
      throw new DataError(
        `The adaptive section ${describe(identifier)} needs an entry in the catSections of the definition: its URL prefix and the identifier that createSection returned.`,
      );
    }
  }
  return given;
}

/** Builds the course of a test: the static checks, then the structure and every item it can reach. */
function testCourse(definition: Extract<DeliveryDefinition, { kind: "test" }>, options: EngineOptions): Course {
  const { test, base, resolvers, catSections = new Map<string, CatSectionRef>() } = definition;
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
    checkSynchronous(item, "The resolver items");
    resolved.set(path, item);
    items.set(node.model.identifier, {
      node,
      control: sessionControl(node),
      candidates: candidatesOf(item, path, resolvers),
    });
  }
  return courseOf(structure, items, checked, {
    catSections: checkCatSections(structure, catSections),
    standalone: false,
  });
}

/** Builds the course of an item delivered alone: a test of one nonlinear part with the item. */
function itemCourse(definition: Extract<DeliveryDefinition, { kind: "item" }>, options: EngineOptions): Course {
  const { item, base, control, resolvers } = definition;
  checkItem(item);
  checkString(base, "The base");
  if (resolvers !== undefined) checkRecord(resolvers, "The resolvers must be an object with a function stimuli");
  if (resolvers !== undefined) checkFunction(resolvers.stimuli, "The stimuli of the resolvers must be a function");
  const checked = checkEngineOptions(options);
  const effective = standaloneSessionControl(control);
  gate(validateAsi({ kind: "item", item }, { ...checked, path: base }), "item");
  const structure = standaloneTest(item);
  const node = structure.itemRef(item.identifier);
  if (node === undefined)
    throw new DataError(`The test of the item has no item reference ${describe(item.identifier)}.`);
  const own = makeCandidate(item.identifier, { kind: "qti", item }, { hazards: [], languages: [] }, base, resolvers);
  return courseOf(structure, new Map([[item.identifier, { node, control: effective, candidates: [own] }]]), checked, {
    catSections: new Map(),
    standalone: true,
  });
}

/**
 * Builds the course of a definition, after the static checks.
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
